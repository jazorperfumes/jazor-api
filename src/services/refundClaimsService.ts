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
      refunds: {
        where: { orderItemId: input.orderItemId, kind: "DAMAGE_CLAIM" },
        select: { id: true },
      },
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
  if (order.refunds.length > 0) {
    throw new HttpError(409, "REFUND_CLAIM_EXISTS", "Claim already exists for this item");
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

  // Refund the amount the customer actually paid for THIS item: its line total
  // minus its proportional share of the order's monetary discount. Shipping and
  // gift-wrap are order-level charges (service already rendered) and are not
  // refunded for a single-item damage claim. Gift lines are excluded from both
  // the discount pool and the paid-subtotal denominator.
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
  const refundAmount = Math.max(0, item.lineTotalPrice - discountShare);

  const refundId = await prisma.$transaction(async (tx) => {
    // Defensive: re-check uniqueness inside tx (closes race between two parallel submits).
    const dup = await tx.refund.findFirst({
      where: { orderItemId: item.id, kind: "DAMAGE_CLAIM" },
      select: { id: true },
    });
    if (dup) {
      throw new HttpError(409, "REFUND_CLAIM_EXISTS", "Claim already exists for this item");
    }

    const refund = await tx.refund.create({
      data: {
        paymentId: capturedPayment.id,
        orderId: order.id,
        orderItemId: item.id,
        kind: "DAMAGE_CLAIM",
        reasonCode: input.reasonCode,
        userDescription: input.userDescription.trim(),
        amountPrice: refundAmount,
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
 * Per-item claim eligibility for the UI: returns the set of orderItemIds that
 * (a) belong to a delivered order within the claim window AND
 * (b) have no existing DAMAGE_CLAIM refund.
 */
export async function eligibleItemIds(userId: string, orderId: string): Promise<string[]> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      items: { select: { id: true, isGift: true } },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
      refunds: {
        where: { kind: "DAMAGE_CLAIM" },
        select: { orderItemId: true },
      },
    },
  });
  if (!order) return [];
  if (order.status !== "DELIVERED" && order.status !== "REFUND_PROCESSING") return [];
  const delivered = order.shipments[0]?.deliveredAt;
  if (!delivered) return [];
  if (new Date() > eligibilityCutoff(delivered)) return [];
  const claimed = new Set(order.refunds.map((r) => r.orderItemId).filter(Boolean) as string[]);
  // Free gift lines aren't refundable — never offer them as claimable.
  return order.items.filter((i) => !i.isGift && !claimed.has(i.id)).map((i) => i.id);
}
