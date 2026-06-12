import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeAgent } from "../helpers/app.js";
import { makeProduct, makeUser, validAddress } from "../helpers/factories.js";
import { prisma } from "../../src/lib/prisma.js";
import * as razorpayService from "../../src/services/razorpayService.js";

async function setupDeliveredOrder(opts: { deliveredAt?: Date } = {}) {
  const user = await makeUser({ verified: true });
  const product = await makeProduct({ price: 100_000, stock: 5 });
  const variant = product.variants[0];

  const order = await prisma.order.create({
    data: {
      orderNumber: `JZ-TEST-${Math.floor(Math.random() * 1e6)}`,
      userId: user.id,
      email: user.email,
      phone: validAddress.phone,
      status: "DELIVERED",
      subtotalPrice: 100_000,
      shippingPrice: 0,
      totalPrice: 100_000,
      shippingAddress: validAddress as unknown as object,
      paidAt: new Date(),
      items: {
        create: {
          variantId: variant.id,
          productSnapshot: {
            name: { en: "Test Perfume", ar: "" },
            slug: product.slug,
            image: null,
            sizeMl: 50,
            sku: variant.sku,
            collection: product.collection,
            family: product.family,
          } as unknown as object,
          unitPrice: 100_000,
          qty: 1,
          lineTotalPrice: 100_000,
        },
      },
      payments: {
        create: {
          provider: "razorpay",
          providerOrderId: "rzp_o",
          providerPaymentId: "pay_captured_test",
          amountPrice: 100_000,
          status: "CAPTURED",
          capturedAt: new Date(),
        },
      },
      shipments: {
        create: {
          provider: "manual",
          status: "DELIVERED",
          deliveredAt: opts.deliveredAt ?? new Date(Date.now() - 86_400_000), // yesterday
        },
      },
    },
    include: { items: true, payments: true, shipments: true },
  });

  return { user, product, variant, order };
}

async function loginAs(email: string, password: string) {
  const agent = await makeAgent();
  await agent.post("/api/auth/login").send({ email, password });
  return agent;
}

const ONE_PX_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgAAIAAAUAAY27m/MAAAAASUVORK5CYII=",
  "base64",
);

describe("POST /api/account/refund-claims", () => {
  it("submits a claim within window, creates REQUESTED Refund + RefundImage rows", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);

    const res = await agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "The bottle arrived cracked with leakage.")
      .attach("images", ONE_PX_PNG, { filename: "damage.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("REQUESTED");
    expect(res.body.data.images.length).toBe(1);

    const refunds = await prisma.refund.findMany({
      where: { orderId: order.id, kind: "DAMAGE_CLAIM" },
      include: { images: true },
    });
    expect(refunds.length).toBe(1);
    expect(refunds[0].status).toBe("REQUESTED");
    expect(refunds[0].images.length).toBe(1);
  });

  it("rejects when no images attached", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);
    const res = await agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Bottle broken on arrival.");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IMAGE_REQUIRED");
  });

  it("400 FILE_INVALID when uploading >5 images", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);

    let req = agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Six images attached on purpose.");
    for (let i = 0; i < 6; i += 1) {
      req = req.attach("images", ONE_PX_PNG, { filename: `d${i}.png`, contentType: "image/png" });
    }
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_INVALID");
  });

  it("400 FILE_INVALID for disallowed mime type", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);
    const res = await agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Trying to sneak in a text file.")
      .attach("images", Buffer.from("not an image"), {
        filename: "evil.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("FILE_INVALID");
  });

  it("400 REFUND_CLAIM_EXPIRED outside window", async () => {
    const { user, order } = await setupDeliveredOrder({
      deliveredAt: new Date(Date.now() - 30 * 86_400_000), // 30d ago, window is 7d
    });
    const agent = await loginAs(user.email, user.password);
    const res = await agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Filed too late by design.")
      .attach("images", ONE_PX_PNG, { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("REFUND_CLAIM_EXPIRED");
  });

  it("409 REFUND_CLAIM_EXISTS for second submit on same item", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);
    const send = () =>
      agent
        .post("/api/account/refund-claims")
        .field("orderId", order.id)
        .field("orderItemId", order.items[0].id)
        .field("reasonCode", "DAMAGED_BOTTLE")
        .field("userDescription", "First submit body should exceed ten chars.")
        .attach("images", ONE_PX_PNG, { filename: "x.png", contentType: "image/png" });

    const r1 = await send();
    expect(r1.status).toBe(201);
    const r2 = await send();
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe("REFUND_CLAIM_EXISTS");
  });

  it("400 VALIDATION_ERROR for short description", async () => {
    const { user, order } = await setupDeliveredOrder();
    const agent = await loginAs(user.email, user.password);
    const res = await agent
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "short")
      .attach("images", ONE_PX_PNG, { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("Admin approve/reject refund claim", () => {
  beforeEach(() => {
    vi.mocked(razorpayService.refundPayment).mockResolvedValue({
      providerRefundId: "rfnd_admin_test",
      amountPaise: 100_000,
      status: "PROCESSED",
    });
  });

  it("approve calls razorpay.refundPayment with correct amount + payment id", async () => {
    const { user, order } = await setupDeliveredOrder();
    const buyer = await loginAs(user.email, user.password);
    const submit = await buyer
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Bottle arrived damaged and leaking.")
      .attach("images", ONE_PX_PNG, { filename: "d.png", contentType: "image/png" });
    expect(submit.status).toBe(201);
    const refundId = submit.body.data.id as string;

    const admin = await makeUser({ role: "ADMIN" });
    const adminAgent = await loginAs(admin.email, admin.password);

    const res = await adminAgent
      .post(`/api/admin/refund-claims/${refundId}/approve`)
      .send({ reviewNote: "ok" });
    expect(res.status).toBe(200);

    expect(razorpayService.refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        providerPaymentId: "pay_captured_test",
        amountPaise: 100_000,
      }),
    );

    const refund = await prisma.refund.findUnique({ where: { id: refundId } });
    expect(refund?.status).toBe("PROCESSED");
    expect(refund?.providerRefundId).toBe("rfnd_admin_test");
  });

  it("reject sets status REJECTED, stores reviewNote, does NOT call razorpay", async () => {
    const { user, order } = await setupDeliveredOrder();
    const buyer = await loginAs(user.email, user.password);
    const submit = await buyer
      .post("/api/account/refund-claims")
      .field("orderId", order.id)
      .field("orderItemId", order.items[0].id)
      .field("reasonCode", "DAMAGED_BOTTLE")
      .field("userDescription", "Bottle arrived damaged and leaking.")
      .attach("images", ONE_PX_PNG, { filename: "d.png", contentType: "image/png" });
    const refundId = submit.body.data.id as string;

    const admin = await makeUser({ role: "ADMIN" });
    const adminAgent = await loginAs(admin.email, admin.password);

    const res = await adminAgent
      .post(`/api/admin/refund-claims/${refundId}/reject`)
      .send({ reviewNote: "Photos inconclusive; please resubmit." });
    expect(res.status).toBe(200);

    const refund = await prisma.refund.findUnique({ where: { id: refundId } });
    expect(refund?.status).toBe("REJECTED");
    expect(refund?.reviewNote).toMatch(/inconclusive/);
    expect(razorpayService.refundPayment).not.toHaveBeenCalled();
  });
});
