import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyPaymentSignature,
  verifyWebhookSignature,
} from "../../src/services/razorpayService.js";
import { env } from "../../src/env.js";

function hmac(secret: string, data: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

describe("verifyPaymentSignature", () => {
  it("returns true for a valid HMAC of order_id|payment_id", () => {
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const sig = hmac(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`);
    expect(
      verifyPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature: sig,
      }),
    ).toBe(true);
  });

  it("rejects tampered signature", () => {
    expect(
      verifyPaymentSignature({
        razorpayOrderId: "order_a",
        razorpayPaymentId: "pay_b",
        signature: "deadbeef",
      }),
    ).toBe(false);
  });

  it("rejects mismatched length without throwing (timingSafeEqual guard)", () => {
    expect(
      verifyPaymentSignature({
        razorpayOrderId: "o",
        razorpayPaymentId: "p",
        signature: "abc",
      }),
    ).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  it("validates correctly signed raw body", () => {
    const body = Buffer.from(JSON.stringify({ event: "payment.captured" }));
    const sig = hmac(env.RAZORPAY_WEBHOOK_SECRET, body);
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it("rejects missing signature", () => {
    expect(verifyWebhookSignature(Buffer.from("{}"), undefined)).toBe(false);
  });

  it("rejects wrong signature", () => {
    expect(verifyWebhookSignature(Buffer.from("{}"), "0".repeat(64))).toBe(false);
  });
});
