import type { Request, Response } from "express";
import type { ShipmentStatus as PrismaShipmentStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getShippingProvider } from "../services/shipping/index.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { env } from "../env.js";
import type { WebhookEvent } from "../services/shipping/types.js";

const PROVIDER_SIGNATURE_HEADER: Record<string, string> = {
  nimbuspost: "x-nimbuspost-signature",
};

/**
 * /api/shipping/webhook — raw body verified by active provider, idempotent via
 * WebhookEvent. Provider selection follows env.SHIPPING_PROVIDER, so swapping
 * providers requires only an env flip + dashboard webhook URL update.
 */
export async function webhook(req: Request, res: Response) {
  if (env.SHIPPING_PROVIDER === "manual") {
    logger.warn("shipping webhook hit while provider=manual", {});
    ok(res, { ok: true, disabled: true });
    return;
  }

  const provider = getShippingProvider();
  const sigHeader = PROVIDER_SIGNATURE_HEADER[provider.name];
  const signature = sigHeader ? req.header(sigHeader) : undefined;
  const rawBody = Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from("");

  let event: WebhookEvent | null;
  try {
    event = provider.parseWebhookEvent(rawBody, signature);
  } catch (err) {
    // Signature/parse failures already throw HttpError with the right code.
    throw err instanceof HttpError ? err : new HttpError(400, "VALIDATION_ERROR", "Webhook invalid");
  }
  if (!event) {
    ok(res, { ok: true, skipped: true });
    return;
  }

  try {
    await prisma.webhookEvent.create({
      data: {
        provider: provider.name,
        eventId: event.eventId,
        eventType: event.eventType,
        payload: event.raw as object,
        signature: signature ?? "",
        status: "pending",
      },
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      ok(res, { ok: true, duplicate: true });
      return;
    }
    throw err;
  }

  try {
    await processEvent(event);
    await prisma.webhookEvent.update({
      where: { eventId: event.eventId },
      data: { status: "processed", processedAt: new Date() },
    });
  } catch (err) {
    logger.error("shipping webhook handler failed", err as Error, {
      provider: provider.name,
      event: event.eventType,
      awb: event.awb,
    });
    await prisma.webhookEvent
      .update({
        where: { eventId: event.eventId },
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

async function processEvent(event: WebhookEvent): Promise<void> {
  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [
        event.awb ? { awb: event.awb } : { id: "__never__" },
        event.providerShipmentId
          ? { providerShipmentId: event.providerShipmentId }
          : { id: "__never__" },
      ],
    },
  });
  if (!shipment) {
    logger.warn("shipping webhook for unknown shipment", {
      awb: event.awb,
      providerShipmentId: event.providerShipmentId,
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        status: event.status,
        description: event.description ?? null,
        location: event.location ?? null,
        occurredAt: event.occurredAt,
        rawPayload: event.raw as object,
      },
    });

    // Only advance status forward — don't overwrite DELIVERED with a late
    // IN_TRANSIT event.
    const rank: Record<PrismaShipmentStatus, number> = {
      CREATED: 0,
      MANIFESTED: 1,
      PICKED_UP: 2,
      IN_TRANSIT: 3,
      OUT_FOR_DELIVERY: 4,
      DELIVERED: 5,
      RTO: 6,
      CANCELLED: 6,
    };
    if (rank[event.status] > rank[shipment.status]) {
      const data: {
        status: PrismaShipmentStatus;
        deliveredAt?: Date;
        rtoAt?: Date;
      } = { status: event.status };
      if (event.status === "DELIVERED") data.deliveredAt = event.occurredAt;
      if (event.status === "RTO") data.rtoAt = event.occurredAt;
      await tx.shipment.update({ where: { id: shipment.id }, data });
    }

    if (event.status === "DELIVERED") {
      const order = await tx.order.findUnique({
        where: { id: shipment.orderId },
        select: { status: true },
      });
      if (order && order.status === "SHIPPED") {
        await tx.order.update({
          where: { id: shipment.orderId },
          data: { status: "DELIVERED" },
        });
        await tx.orderStatusEvent.create({
          data: {
            orderId: shipment.orderId,
            status: "DELIVERED",
            note: `delivered ${event.deliveredTo ? `to ${event.deliveredTo}` : ""}`.trim(),
            createdByUserId: null,
          },
        });
      }
    }
  });
}
