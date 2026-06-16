import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgent } from "../helpers/app.js";
import { addCartItem, makePromotion, makeProduct, makeUser, validAddress } from "../helpers/factories.js";
import { prisma } from "../../src/lib/prisma.js";
import * as ordersService from "../../src/services/ordersService.js";
import * as razorpayService from "../../src/services/razorpayService.js";

async function loginAs(email: string, password: string) {
  const agent = await makeAgent();
  await agent.post("/api/auth/login").send({ email, password });
  return agent;
}

describe("POST /api/orders", () => {
  beforeEach(() => {
    vi.mocked(razorpayService.createOrder).mockResolvedValue("rzp_order_int_test");
  });

  it("creates CREATED order, decrements stock atomically, creates Payment row", async () => {
    const user = await makeUser({ email: "buyer@jazor.test" });
    const product = await makeProduct({ price: 200_000, stock: 5 });
    const variant = product.variants[0];
    await addCartItem(user.id, variant.id, 2);

    const agent = await loginAs(user.email, user.password);
    const res = await agent
      .post("/api/orders")
      .send({ shippingAddress: validAddress, giftWrap: false });

    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toMatch(/^JZ-/);
    expect(res.body.data.razorpayOrderId).toBe("rzp_order_int_test");

    const v = await prisma.productVariant.findUnique({ where: { id: variant.id } });
    expect(v?.stock).toBe(3);

    const order = await prisma.order.findFirst({
      where: { userId: user.id },
      include: { items: true, payments: true },
    });
    expect(order?.status).toBe("CREATED");
    expect(order?.items[0].qty).toBe(2);
    expect(order?.items[0].lineTotalPrice).toBe(400_000);
    expect(order?.payments[0].status).toBe("CREATED");
    expect(order?.payments[0].providerOrderId).toBe("rzp_order_int_test");

    // InventoryAdjustment audit row written
    const adj = await prisma.inventoryAdjustment.findFirst({
      where: { variantId: variant.id, reason: "order_placed" },
    });
    expect(adj?.delta).toBe(-2);

    // ₹4,000 subtotal clears the ₹2,599 free-shipping threshold, so shipping
    // is waived (no promo needed).
    expect(order?.subtotalPrice).toBe(400_000);
    expect(order?.shippingPrice).toBe(0);
    expect(order?.totalPrice).toBe(400_000);
  });

  it("re-quotes server-side — UI prices are not trusted", async () => {
    // The endpoint has no price field at all; this asserts the contract by
    // attempting to send tampered totals via extras and confirming the response
    // ignores them.
    const user = await makeUser();
    const product = await makeProduct({ price: 100_000, stock: 5 });
    await addCartItem(user.id, product.variants[0].id, 1);
    const agent = await loginAs(user.email, user.password);

    const res = await agent.post("/api/orders").send({
      shippingAddress: validAddress,
      giftWrap: false,
      // Tampering attempts — must be ignored.
      subtotalPrice: 1,
      totalPrice: 1,
      amountPaise: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.amountPaise).toBe(100_000 + 9_900); // server-calculated
  });

  it("409 OUT_OF_STOCK when requested qty > available", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 100_000, stock: 1 });
    await addCartItem(user.id, product.variants[0].id, 3);
    const agent = await loginAs(user.email, user.password);

    const res = await agent.post("/api/orders").send({ shippingAddress: validAddress });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OUT_OF_STOCK");

    const v = await prisma.productVariant.findUnique({ where: { id: product.variants[0].id } });
    expect(v?.stock).toBe(1);
  });

  it("concurrent orders for last unit — exactly one succeeds, stock never negative", async () => {
    const product = await makeProduct({ price: 100_000, stock: 1 });
    const u1 = await makeUser({ email: "race1@jazor.test" });
    const u2 = await makeUser({ email: "race2@jazor.test" });
    await addCartItem(u1.id, product.variants[0].id, 1);
    await addCartItem(u2.id, product.variants[0].id, 1);

    const a1 = await loginAs(u1.email, u1.password);
    const a2 = await loginAs(u2.email, u2.password);

    const [r1, r2] = await Promise.all([
      a1.post("/api/orders").send({ shippingAddress: validAddress }),
      a2.post("/api/orders").send({ shippingAddress: validAddress }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const v = await prisma.productVariant.findUnique({ where: { id: product.variants[0].id } });
    expect(v?.stock).toBe(0);
  });

  it("400 CART_EMPTY when cart is empty", async () => {
    const user = await makeUser();
    const agent = await loginAs(user.email, user.password);
    const res = await agent.post("/api/orders").send({ shippingAddress: validAddress });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CART_EMPTY");
  });

  it("writes an uncommitted redemption at create; usedCount stays 0 until PAID", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 50_000, stock: 5 });
    const d = await makePromotion({ code: "TEN", rewardType: "PERCENT", value: 10 });
    await addCartItem(user.id, product.variants[0].id, 1);
    const agent = await loginAs(user.email, user.password);

    const res = await agent
      .post("/api/orders")
      .send({ shippingAddress: validAddress, discountCodes: [d.code] });
    expect(res.status).toBe(201);

    const fresh = await prisma.promotion.findUnique({ where: { id: d.id } });
    expect(fresh?.usedCount).toBe(0); // increments only on capture

    const redemption = await prisma.promotionRedemption.findFirst({
      where: { promotionId: d.id },
    });
    expect(redemption).toBeTruthy();
    expect(redemption?.committed).toBe(false);
  });

  it("400 ADDRESS_INVALID for unsupported country", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 50_000, stock: 5 });
    await addCartItem(user.id, product.variants[0].id, 1);
    const agent = await loginAs(user.email, user.password);

    const res = await agent
      .post("/api/orders")
      .send({ shippingAddress: { ...validAddress, country: "US" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ADDRESS_INVALID");

    const v = await prisma.productVariant.findUnique({ where: { id: product.variants[0].id } });
    expect(v?.stock).toBe(5); // no decrement on failed validation
  });
});

describe("stock reaper", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels CREATED orders past TTL and restores stock", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 50_000, stock: 5 });
    const variantId = product.variants[0].id;
    await addCartItem(user.id, variantId, 2);
    const agent = await loginAs(user.email, user.password);

    const create = await agent
      .post("/api/orders")
      .send({ shippingAddress: validAddress });
    expect(create.status).toBe(201);
    const orderId = create.body.data.orderId;

    // Backdate the order to 1 hour ago — beyond default TTL (30 min).
    await prisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });

    const cancelled = await ordersService.reapStaleCreatedOrders();
    expect(cancelled).toBe(1);

    const refreshed = await prisma.order.findUnique({ where: { id: orderId } });
    expect(refreshed?.status).toBe("CANCELLED");

    const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
    expect(variant?.stock).toBe(5);

    const adj = await prisma.inventoryAdjustment.findFirst({
      where: { variantId, reason: "payment_timeout" },
    });
    expect(adj?.delta).toBe(2);
  });

  it("does not cancel orders inside TTL", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 50_000, stock: 5 });
    await addCartItem(user.id, product.variants[0].id, 1);
    const agent = await loginAs(user.email, user.password);
    await agent.post("/api/orders").send({ shippingAddress: validAddress });

    const cancelled = await ordersService.reapStaleCreatedOrders();
    expect(cancelled).toBe(0);
  });
});
