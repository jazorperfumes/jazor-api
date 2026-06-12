import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import * as ordersService from "../services/ordersService.js";
import * as razorpayService from "../services/razorpayService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import type { RazorpayVerifyResponse } from "../types/orders.js";

const verifySchema = z.object({
  orderId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function verify(req: Request, res: Response) {
  const userId = requireUserId(req);
  const body = verifySchema.parse(req.body ?? {});
  const { orderId, orderNumber } = await ordersService.verifyAndCapture(userId, body);
  ok<RazorpayVerifyResponse>(res, { orderId, orderNumber, status: "PAID" });
}

interface RazorpayWebhookBody {
  event: string;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
    order?: { entity?: Record<string, unknown> };
  };
}

/**
 * Webhook endpoint — receives raw bytes. Always returns 200 once the event is
 * recorded (idempotent via WebhookEvent.eventId unique). Processing errors are
 * logged but don't 5xx the response, since Razorpay would otherwise replay
 * the same event and amplify noise.
 */
export async function webhook(req: Request, res: Response) {
  const signature = req.header("x-razorpay-signature");
  // `express.raw` lands the body as Buffer when content-type matches; default to empty buffer.
  const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");

  if (!razorpayService.verifyWebhookSignature(rawBody, signature)) {
    throw new HttpError(400, "SIGNATURE_INVALID", "Webhook signature invalid");
  }

  let parsed: RazorpayWebhookBody;
  try {
    parsed = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookBody;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "Webhook body not JSON");
  }

  const eventId = req.header("x-razorpay-event-id") ?? `${parsed.event}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Idempotency: unique eventId. If we've seen this event, return 200 silently.
  try {
    await prisma.webhookEvent.create({
      data: {
        provider: "razorpay",
        eventId,
        eventType: parsed.event,
        payload: parsed as unknown as object,
        signature: signature ?? "",
        status: "pending",
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      res.status(200).json({ ok: true, data: { duplicate: true } });
      return;
    }
    throw err;
  }

  try {
    switch (parsed.event) {
      case "payment.captured":
      case "order.paid":
        await ordersService.handlePaymentCaptured(parsed.payload?.payment?.entity ?? {});
        break;
      case "payment.failed":
        await ordersService.handlePaymentFailed(parsed.payload?.payment?.entity ?? {});
        break;
      case "refund.processed":
        await ordersService.handleRefundProcessed(parsed.payload?.refund?.entity ?? {});
        break;
      default:
        // Unhandled event — acknowledge so Razorpay doesn't retry.
        break;
    }
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { status: "processed", processedAt: new Date() },
    });
  } catch (err) {
    logger.error("webhook handler failed", err as Error, { event: parsed.event, eventId });
    await prisma.webhookEvent
      .update({
        where: { eventId },
        data: {
          status: "failed",
          errorMessage: (err as Error).message,
          processedAt: new Date(),
        },
      })
      .catch(() => undefined);
  }

  ok(res, { ok: true });
}
