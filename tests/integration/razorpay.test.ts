import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgent } from "../helpers/app.js";
import { addCartItem, makePromotion, makeProduct, makeUser, validAddress } from "../helpers/factories.js";
import { prisma } from "../../src/lib/prisma.js";
import { env } from "../../src/env.js";
import * as razorpayService from "../../src/services/razorpayService.js";
import * as mailService from "../../src/services/mailService.js";

function paymentSig(orderId: string, paymentId: string): string {
  return crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function webhookSig(body: string): string {
  return crypto.createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
}

async function placeOrder() {
  const user = await makeUser();
  const product = await makeProduct({ price: 100_000, stock: 5 });
  await addCartItem(user.id, product.variants[0].id, 1);
  vi.mocked(razorpayService.createOrder).mockResolvedValue("rzp_order_v1");

  const agent = await makeAgent();
  await agent.post("/api/auth/login").send({ email: user.email, password: user.password });
  const res = await agent.post("/api/orders").send({ shippingAddress: validAddress });
  return {
    user,
    agent,
    orderId: res.body.data.orderId as string,
    razorpayOrderId: res.body.data.razorpayOrderId as string,
  };
}

describe("POST /api/razorpay/verify", () => {
  it("400 SIGNATURE_INVALID for forged signature", async () => {
    const { agent, orderId, razorpayOrderId } = await placeOrder();
    const res = await agent.post("/api/razorpay/verify").send({
      orderId,
      razorpayOrderId,
      razorpayPaymentId: "pay_x",
      razorpaySignature: "deadbeef",
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order?.status).toBe("CREATED");
  });

  it("captures order, clears cart, flips Payment to CAPTURED on valid signature", async () => {
    const { user, agent, orderId, razorpayOrderId } = await placeOrder();
    const paymentId = "pay_legit";
    const sig = paymentSig(razorpayOrderId, paymentId);

    const res = await agent.post("/api/razorpay/verify").send({
      orderId,
      razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PAID");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    expect(order?.status).toBe("PAID");
    expect(order?.paidAt).toBeInstanceOf(Date);
    expect(order?.payments[0].status).toBe("CAPTURED");
    expect(order?.payments[0].providerPaymentId).toBe(paymentId);

    const cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: true },
    });
    expect(cart?.items.length ?? 0).toBe(0);
  });

  it("increments promotion usedCount + commits redemption on capture", async () => {
    const user = await makeUser();
    const d = await makePromotion({ code: "PCT15", rewardType: "PERCENT", value: 15 });
    const product = await makeProduct({ price: 100_000, stock: 5 });
    await addCartItem(user.id, product.variants[0].id, 1);
    vi.mocked(razorpayService.createOrder).mockResolvedValue("rzp_order_disc");

    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: user.email, password: user.password });
    const create = await agent
      .post("/api/orders")
      .send({ shippingAddress: validAddress, discountCodes: [d.code] });
    expect(create.status).toBe(201);

    const orderId = create.body.data.orderId as string;
    const paymentId = "pay_disc";
    const sig = paymentSig("rzp_order_disc", paymentId);

    const ver = await agent.post("/api/razorpay/verify").send({
      orderId,
      razorpayOrderId: "rzp_order_disc",
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    });
    expect(ver.status).toBe(200);

    const fresh = await prisma.promotion.findUnique({ where: { id: d.id } });
    expect(fresh?.usedCount).toBe(1);

    const red = await prisma.promotionRedemption.findFirst({ where: { orderId } });
    expect(red).toBeTruthy();
    expect(red?.committed).toBe(true);
  });

  it("is idempotent — second verify with same data does not double-mutate", async () => {
    const { agent, orderId, razorpayOrderId } = await placeOrder();
    const paymentId = "pay_idem";
    const sig = paymentSig(razorpayOrderId, paymentId);
    const body = { orderId, razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sig };

    const r1 = await agent.post("/api/razorpay/verify").send(body);
    const r2 = await agent.post("/api/razorpay/verify").send(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const events = await prisma.orderStatusEvent.count({
      where: { orderId, status: "PAID" },
    });
    expect(events).toBe(1);
  });
});

describe("POST /api/razorpay/webhook (raw-body, idempotent)", () => {
  beforeEach(() => {
    vi.mocked(razorpayService.createOrder).mockResolvedValue("rzp_order_wh");
  });

  it("400 SIGNATURE_INVALID when x-razorpay-signature missing/wrong", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/razorpay/webhook")
      .set("Content-Type", "application/json")
      .send({ event: "payment.captured" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SIGNATURE_INVALID");
  });

  it("records WebhookEvent and returns 200 silently on duplicate eventId", async () => {
    const eventId = "evt_dup_1";
    const body = JSON.stringify({ event: "payment.failed", payload: {} });
    const sig = webhookSig(body);
    const agent = await makeAgent();

    const r1 = await agent
      .post("/api/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sig)
      .set("x-razorpay-event-id", eventId)
      .send(body);
    expect(r1.status).toBe(200);

    const r2 = await agent
      .post("/api/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sig)
      .set("x-razorpay-event-id", eventId)
      .send(body);
    expect(r2.status).toBe(200);
    expect(r2.body.data.duplicate).toBe(true);

    const events = await prisma.webhookEvent.findMany({ where: { eventId } });
    expect(events.length).toBe(1);
  });

  it("payment.captured flips Order PAID + clears cart + sends mail", async () => {
    const user = await makeUser();
    const product = await makeProduct({ price: 100_000, stock: 5 });
    await addCartItem(user.id, product.variants[0].id, 1);

    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: user.email, password: user.password });
    const create = await agent.post("/api/orders").send({ shippingAddress: validAddress });
    const orderId = create.body.data.orderId as string;

    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: "pay_wh", order_id: "rzp_order_wh", method: "upi" },
        },
      },
    });

    const res = await agent
      .post("/api/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", webhookSig(body))
      .set("x-razorpay-event-id", "evt_cap_1")
      .send(body);
    expect(res.status).toBe(200);

    // Async fire-and-forget mail; await microtasks.
    await new Promise((r) => setTimeout(r, 50));

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true },
    });
    expect(order?.status).toBe("PAID");
    expect(order?.payments[0].method).toBe("upi");

    const cart = await prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: true },
    });
    expect(cart?.items.length ?? 0).toBe(0);
    expect(mailService.sendMail).toHaveBeenCalled();
  });

  it("payment.captured is idempotent when /verify already PAID the order", async () => {
    const { agent, orderId, razorpayOrderId } = await placeOrder();
    const paymentId = "pay_first";
    const sig = paymentSig(razorpayOrderId, paymentId);
    await agent.post("/api/razorpay/verify").send({
      orderId,
      razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    });

    const body = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId } } },
    });
    await agent
      .post("/api/razorpay/webhook")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", webhookSig(body))
      .set("x-razorpay-event-id", "evt_after_verify")
      .send(body);

    const paidEvents = await prisma.orderStatusEvent.count({
      where: { orderId, status: "PAID" },
    });
    expect(paidEvents).toBe(1);
  });
});
