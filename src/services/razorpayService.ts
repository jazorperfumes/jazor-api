import crypto from "node:crypto";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";

/** Razorpay REST base. Test + live use the same host; auth keys differ. */
const RAZORPAY_BASE = "https://api.razorpay.com";

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt: string | null;
  status: string;
}

interface CreateOrderInput {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}

function basicAuthHeader(): string {
  const credentials = `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/**
 * POST /v1/orders — Razorpay's pre-payment receipt. The returned `id`
 * (razorpay_order_id) is what the client widget consumes. Throws on non-2xx;
 * caller is expected to surface a generic 502 so the local Order can be reaped.
 */
export async function createOrder(input: CreateOrderInput): Promise<string> {
  const res = await fetch(`${RAZORPAY_BASE}/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("Razorpay create-order failed", new Error(text), {
      status: res.status,
      receipt: input.receipt,
    });
    throw new HttpError(502, "INTERNAL_ERROR", "Payment provider unavailable");
  }

  const json = (await res.json()) as RazorpayOrderResponse;
  return json.id;
}

interface RazorpayRefundResponse {
  id: string;
  payment_id: string;
  amount: number;
  currency: string;
  /** "processed" | "pending" | "failed" — provider's settlement state. */
  status: string;
  speed_processed?: string;
  speed_requested?: string;
}

export interface RefundResult {
  providerRefundId: string;
  amountPaise: number;
  status: "PROCESSED" | "PENDING" | "FAILED";
}

/**
 * POST /v1/payments/:id/refund — initiates a refund against a captured payment.
 * Throws HttpError on non-2xx so the caller can mark the local Refund row FAILED
 * and surface a warning. Webhook `refund.processed` later flips PENDING→PROCESSED.
 */
export async function refundPayment(input: {
  providerPaymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}): Promise<RefundResult> {
  const res = await fetch(
    `${RAZORPAY_BASE}/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        notes: input.notes,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error("Razorpay refund failed", new Error(text), {
      status: res.status,
      paymentId: input.providerPaymentId,
    });
    throw new HttpError(502, "PAYMENT_FAILED", "Refund provider unavailable");
  }

  const json = (await res.json()) as RazorpayRefundResponse;
  const status =
    json.status === "processed"
      ? "PROCESSED"
      : json.status === "failed"
        ? "FAILED"
        : "PENDING";
  return {
    providerRefundId: json.id,
    amountPaise: json.amount,
    status,
  };
}

/**
 * HMAC-SHA256 of `${order_id}|${payment_id}` using KEY_SECRET, hex digest.
 * timing-safe compare to mitigate trivial timing oracle.
 */
export function verifyPaymentSignature(input: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(input.signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Webhook signature: HMAC-SHA256 of the RAW request body using WEBHOOK_SECRET.
 * `rawBody` must be the unparsed bytes — wire the route with `express.raw`
 * BEFORE the global `express.json()` middleware.
 */
export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
