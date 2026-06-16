import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { env } from "../env.js";
import { uploadBuffer, destroy } from "../lib/cloudinary.js";
import { sendMail, refundClaimSubmittedEmail, adminRefundClaimAlertEmail } from "./mailService.js";
import type { I18nString } from "../types/products.js";
import type {
  RefundClaimDto,
  RefundClaimImageDto,
  RefundClaimReasonCode,
} from "../types/refundClaims.js";

const REASON_CODES = new Set<RefundClaimReasonCode>(["DAMAGED_BOTTLE"]);

interface SubmitInput {
  orderId: string;
  orderItemId: string;
  quantity: number;
  reasonCode: RefundClaimReasonCode;
  userDescription: string;
  files: Express.Multer.File[];
}

function readI18nName(value: Prisma.JsonValue | null): I18nString {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { en: "", ar: "" };
  }
  const name = (value as Record<string, unknown>).name;
  if (!name || typeof name !== "object" || Array.isArray(name)) {
    return { en: "", ar: "" };
  }
  const n = name as Record<string, unknown>;
  return {
    en: typeof n.en === "string" ? n.en : "",
    ar: typeof n.ar === "string" ? n.ar : "",
  };
}

function readSnapshotField<T>(value: Prisma.JsonValue | null, key: string, fallback: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const v = (value as Record<string, unknown>)[key];
  return (v ?? fallback) as T;
}

type RefundWithImages = Prisma.RefundGetPayload<{
  include: {
    images: true;
    order: { select: { orderNumber: true } };
    orderItem: { select: { productSnapshot: true } };
  };
}>;

function toDto(r: RefundWithImages): RefundClaimDto {
  const snap = r.orderItem?.productSnapshot ?? null;
  return {
    id: r.id,
    orderId: r.orderId,
    orderNumber: r.order.orderNumber,
    orderItemId: r.orderItemId,
    itemName: snap ? readI18nName(snap) : null,
    itemImage: snap ? readSnapshotField<string | null>(snap, "image", null) : null,
    itemSizeMl: snap ? readSnapshotField<number | null>(snap, "sizeMl", null) : null,
    itemSku: snap ? readSnapshotField<string | null>(snap, "sku", null) : null,
    kind: r.kind,
    reasonCode: r.reasonCode,
    userDescription: r.userDescription,
    reviewNote: r.reviewNote,
    quantity: r.quantity,
    amountPrice: r.amountPrice,
    status: r.status,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    images: r.images.map<RefundClaimImageDto>((i) => ({
      id: i.id,
      url: i.url,
      mimeType: i.mimeType,
      sizeBytes: i.sizeBytes,
      createdAt: i.createdAt.toISOString(),
    })),
  };
}

function eligibilityCutoff(deliveredAt: Date): Date {
  return new Date(deliveredAt.getTime() + env.REFUND_CLAIM_WINDOW_DAYS * 86_400_000);
}

async function uploadImagesToCloud(
  refundId: string,
  files: Express.Multer.File[],
): Promise<{ url: string; publicId: string; mimeType: string; sizeBytes: number }[]> {
  const out: { url: string; publicId: string; mimeType: string; sizeBytes: number }[] = [];
  for (const f of files) {
    const { url, publicId } = await uploadBuffer(f.buffer, `jazor/refund-claims/${refundId}`);
    out.push({ url, publicId, mimeType: f.mimetype, sizeBytes: f.size });
  }
  return out;
}

export async function submit(userId: string, input: SubmitInput): Promise<RefundClaimDto> {
  if (!REASON_CODES.has(input.reasonCode)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Invalid reason code");
  }
  if (input.files.length === 0) {
    throw new HttpError(400, "IMAGE_REQUIRED", "At least one damage photo required");
  }
  if (!input.userDescription || input.userDescription.trim().length < 10) {
    throw new HttpError(400, "VALIDATION_ERROR", "Description must be at least 10 characters");
  }

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, userId },
    include: {
      items: { where: { id: input.orderItemId }, take: 1 },
      payments: { where: { status: "CAPTURED" }, orderBy: { createdAt: "desc" }, take: 1 },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");
  if (order.items.length === 0) {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ELIGIBLE", "Item does not belong to this order");
  }
  if (order.status !== "DELIVERED" && order.status !== "REFUND_PROCESSING") {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ELIGIBLE", "Order must be delivered before claiming");
  }
  const lastShipment = order.shipments[0];
  if (!lastShipment?.deliveredAt) {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ELIGIBLE", "Shipment delivery date missing");
  }
  if (new Date() > eligibilityCutoff(lastShipment.deliveredAt)) {
    throw new HttpError(400, "REFUND_CLAIM_EXPIRED", "Claim window has closed");
  }
  const capturedPayment = order.payments[0];
  if (!capturedPayment) {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ELIGIBLE", "No captured payment to refund");
  }

  const item = order.items[0];

  // Free BxGy gift lines were never paid for — not refundable.
  if (item.isGift) {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ELIGIBLE", "Free gift items are not refundable");
  }

  // Net amount the customer actually paid for THIS line: its line total minus its
  // proportional share of the order's monetary discount. Shipping and gift-wrap
  // are order-level charges (service already rendered) and are not refunded on a
  // damage claim. Gift lines are excluded from both the discount pool and the
  // paid-subtotal denominator.
  const giftAgg = await prisma.orderItem.aggregate({
    where: { orderId: order.id, isGift: true },
    _sum: { lineTotalPrice: true },
  });
  const giftValue = giftAgg._sum.lineTotalPrice ?? 0;
  const paidSubtotal = order.subtotalPrice - giftValue;
  const monetaryDiscount = order.discountPrice - giftValue;
  const discountShare =
    paidSubtotal > 0 && monetaryDiscount > 0
      ? Math.round((monetaryDiscount * item.lineTotalPrice) / paidSubtotal)
      : 0;
  const netLine = Math.max(0, item.lineTotalPrice - discountShare);

  // Claims are per-unit: a line of qty N can be claimed across multiple requests
  // until the cumulative claimed units reach N. Rejected claims free their units.
  const settleable = (s: RefundClaimDto["status"]) => s !== "REJECTED";

  // Refund per claim = round(netLine / qty) × units, except the claim that
  // consumes the final remaining units gets the leftover so the line never
  // over- or under-refunds due to rounding.
  const computeAmount = (
    units: number,
    remainingUnits: number,
    alreadyRefunded: number,
  ): number => {
    const perUnit = Math.round(netLine / item.qty);
    const isLast = units === remainingUnits;
    const raw = isLast ? netLine - alreadyRefunded : perUnit * units;
    return Math.max(0, Math.min(raw, netLine - alreadyRefunded));
  };

  const refundId = await prisma.$transaction(async (tx) => {
    // Lock the order-item row first so concurrent claims on the same line
    // serialize: under READ COMMITTED two parallel submits would otherwise both
    // read the same claimed total (neither insert committed yet) and jointly
    // over-claim the line. FOR UPDATE makes the second submit block until the
    // first commits, then it reads the new row.
    await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE id = ${item.id} FOR UPDATE`;

    const prior = await tx.refund.findMany({
      where: { orderItemId: item.id, kind: "DAMAGE_CLAIM" },
      select: { quantity: true, amountPrice: true, status: true },
    });
    const active = prior.filter((p) => settleable(p.status));
    const claimedQty = active.reduce((s, p) => s + p.quantity, 0);
    const claimedAmount = active.reduce((s, p) => s + p.amountPrice, 0);
    const remainingQty = item.qty - claimedQty;
    if (remainingQty <= 0) {
      throw new HttpError(409, "REFUND_CLAIM_EXISTS", "All units of this item are already claimed");
    }
    if (input.quantity > remainingQty) {
      throw new HttpError(400, "VALIDATION_ERROR", "Quantity exceeds claimable units", {
        remainingQty,
        requested: input.quantity,
      });
    }

    const refund = await tx.refund.create({
      data: {
        paymentId: capturedPayment.id,
        orderId: order.id,
        orderItemId: item.id,
        kind: "DAMAGE_CLAIM",
        reasonCode: input.reasonCode,
        userDescription: input.userDescription.trim(),
        quantity: input.quantity,
        amountPrice: computeAmount(input.quantity, remainingQty, claimedAmount),
        status: "REQUESTED",
        createdByUserId: userId,
      },
    });
    return refund.id;
  });

  let persisted: Awaited<ReturnType<typeof uploadImagesToCloud>> = [];
  try {
    persisted = await uploadImagesToCloud(refundId, input.files);
    await prisma.refundImage.createMany({
      data: persisted.map((p) => ({ refundId, ...p })),
    });
  } catch (err) {
    logger.error("refund claim image persist failed", err as Error, { refundId });
    // Rollback: delete refund row + any uploaded assets. Refund row has no payment-side effect yet.
    await prisma.refund.delete({ where: { id: refundId } }).catch(() => undefined);
    await Promise.all(persisted.map((p) => destroy(p.publicId)));
    throw new HttpError(500, "INTERNAL_ERROR", "Failed to save images");
  }

  const dto = await loadDtoOrThrow(refundId);

  // Fire-and-forget notifications.
  void sendMail({
    to: order.email,
    ...refundClaimSubmittedEmail(dto, order.orderNumber),
  }).catch((e) => logger.error("refund claim user mail failed", e, { refundId }));
  void sendMail({
    to: env.ADMIN_ALERT_EMAIL,
    ...adminRefundClaimAlertEmail(dto, order.orderNumber, order.email),
  }).catch((e) => logger.error("refund claim admin mail failed", e, { refundId }));

  return dto;
}

async function loadDtoOrThrow(refundId: string): Promise<RefundClaimDto> {
  const r = await prisma.refund.findUnique({
    where: { id: refundId },
    include: {
      images: { orderBy: { createdAt: "asc" } },
      order: { select: { orderNumber: true } },
      orderItem: { select: { productSnapshot: true } },
    },
  });
  if (!r) throw new HttpError(404, "REFUND_CLAIM_NOT_FOUND", "Claim not found");
  return toDto(r);
}

export async function getOwn(userId: string, refundId: string): Promise<RefundClaimDto> {
  const r = await prisma.refund.findFirst({
    where: { id: refundId, kind: "DAMAGE_CLAIM", order: { userId } },
    include: {
      images: { orderBy: { createdAt: "asc" } },
      order: { select: { orderNumber: true } },
      orderItem: { select: { productSnapshot: true } },
    },
  });
  if (!r) throw new HttpError(404, "REFUND_CLAIM_NOT_FOUND", "Claim not found");
  return toDto(r);
}

export async function listForOrder(userId: string, orderId: string): Promise<RefundClaimDto[]> {
  const rows = await prisma.refund.findMany({
    where: { orderId, kind: "DAMAGE_CLAIM", order: { userId } },
    include: {
      images: { orderBy: { createdAt: "asc" } },
      order: { select: { orderNumber: true } },
      orderItem: { select: { productSnapshot: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

/**
 * Per-item claim eligibility for the UI: for a delivered order within the claim
 * window, returns each non-gift line that still has unclaimed units, with the
 * remaining claimable quantity. Rejected claims free their units.
 */
export async function eligibleItems(
  userId: string,
  orderId: string,
): Promise<{ orderItemId: string; remaining: number }[]> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      items: { select: { id: true, isGift: true, qty: true } },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
      refunds: {
        where: { kind: "DAMAGE_CLAIM", status: { not: "REJECTED" } },
        select: { orderItemId: true, quantity: true },
      },
    },
  });
  if (!order) return [];
  if (order.status !== "DELIVERED" && order.status !== "REFUND_PROCESSING") return [];
  const delivered = order.shipments[0]?.deliveredAt;
  if (!delivered) return [];
  if (new Date() > eligibilityCutoff(delivered)) return [];

  const claimedByItem = new Map<string, number>();
  for (const r of order.refunds) {
    if (!r.orderItemId) continue;
    claimedByItem.set(r.orderItemId, (claimedByItem.get(r.orderItemId) ?? 0) + r.quantity);
  }
  // Free gift lines aren't refundable — never offer them as claimable.
  return order.items
    .filter((i) => !i.isGift)
    .map((i) => ({ orderItemId: i.id, remaining: i.qty - (claimedByItem.get(i.id) ?? 0) }))
    .filter((i) => i.remaining > 0);
}
