import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import * as razorpayService from "./razorpayService.js";
import {
  sendMail,
  refundClaimApprovedEmail,
  refundClaimRejectedEmail,
} from "./mailService.js";
import type { I18nString } from "../types/products.js";
import type {
  RefundClaimDto,
  RefundClaimImageDto,
  RefundClaimListResponse,
} from "../types/refundClaims.js";

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

type RefundWithRelations = Prisma.RefundGetPayload<{
  include: {
    images: true;
    order: { select: { orderNumber: true } };
    orderItem: { select: { productSnapshot: true } };
  };
}>;

function toDto(r: RefundWithRelations): RefundClaimDto {
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

interface ListQuery {
  status?: RefundClaimDto["status"];
  page?: number;
  pageSize?: number;
}

export async function list(query: ListQuery): Promise<RefundClaimListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const where: Prisma.RefundWhereInput = {
    kind: "DAMAGE_CLAIM",
    ...(query.status ? { status: query.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: {
        images: { orderBy: { createdAt: "asc" } },
        order: { select: { orderNumber: true } },
        orderItem: { select: { productSnapshot: true } },
      },
    }),
    prisma.refund.count({ where }),
  ]);

  return { items: rows.map(toDto), page, pageSize, total };
}

export async function detail(refundId: string): Promise<RefundClaimDto> {
  const r = await prisma.refund.findFirst({
    where: { id: refundId, kind: "DAMAGE_CLAIM" },
    include: {
      images: { orderBy: { createdAt: "asc" } },
      order: { select: { orderNumber: true } },
      orderItem: { select: { productSnapshot: true } },
    },
  });
  if (!r) throw new HttpError(404, "REFUND_CLAIM_NOT_FOUND", "Claim not found");
  return toDto(r);
}

interface ApproveInput {
  reviewNote?: string;
}

export async function approve(
  refundId: string,
  actorId: string,
  input: ApproveInput,
): Promise<RefundClaimDto> {
  const r = await prisma.refund.findFirst({
    where: { id: refundId, kind: "DAMAGE_CLAIM" },
    include: {
      payment: { select: { id: true, providerPaymentId: true } },
      order: { select: { id: true, orderNumber: true, totalPrice: true, status: true, email: true } },
    },
  });
  if (!r) throw new HttpError(404, "REFUND_CLAIM_NOT_FOUND", "Claim not found");
  if (r.status !== "REQUESTED") {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ACTIONABLE", "Claim already reviewed");
  }
  if (!r.payment.providerPaymentId) {
    throw new HttpError(400, "PAYMENT_FAILED", "Captured payment missing on this refund");
  }

  // Optimistically mark APPROVED + flip order to REFUND_PROCESSING in same tx,
  // so other admin actions see the in-flight state immediately.
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        status: "APPROVED",
        reviewNote: input.reviewNote ?? null,
        reviewedByUserId: actorId,
        reviewedAt: new Date(),
      },
    });
    if (r.order.status === "DELIVERED") {
      await tx.order.update({
        where: { id: r.order.id },
        data: { status: "REFUND_PROCESSING" },
      });
      await tx.orderStatusEvent.create({
        data: {
          orderId: r.order.id,
          status: "REFUND_PROCESSING",
          note: `refund_claim_approved:${refundId}`,
          createdByUserId: actorId,
        },
      });
    }
  });

  // Razorpay call sits outside tx (network). Failure → mark FAILED but keep
  // order in REFUND_PROCESSING so admin can retry / reconcile manually.
  let providerRefundId: string | null = null;
  let providerStatus: "PROCESSED" | "PENDING" | "FAILED" = "PENDING";
  try {
    const result = await razorpayService.refundPayment({
      providerPaymentId: r.payment.providerPaymentId,
      amountPaise: r.amountPrice,
      notes: {
        orderId: r.orderId,
        orderNumber: r.order.orderNumber,
        refundId,
        reason: r.reasonCode ?? "DAMAGE_CLAIM",
      },
    });
    providerRefundId = result.providerRefundId;
    providerStatus = result.status;
  } catch (err) {
    logger.error("razorpay refund call failed (claim approval)", err as Error, { refundId });
    providerStatus = "FAILED";
  }

  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        providerRefundId,
        status: providerStatus,
        processedAt: providerStatus === "PROCESSED" ? new Date() : null,
      },
    });

    if (providerStatus === "PROCESSED") {
      await maybeFlipOrderToTerminalState(tx, r.order.id, actorId);
    } else if (providerStatus === "FAILED") {
      // Provider hard-failed. Don't auto-revert order — admin must intervene.
      await tx.orderStatusEvent.create({
        data: {
          orderId: r.order.id,
          status: "REFUND_PROCESSING",
          note: `refund_provider_failed:${refundId}`,
          createdByUserId: actorId,
        },
      });
    }
  });

  const dto = await detail(refundId);

  void sendMail({
    to: r.order.email,
    ...refundClaimApprovedEmail(dto, r.order.orderNumber, providerStatus),
  }).catch((e) => logger.error("refund claim approval mail failed", e, { refundId }));

  return dto;
}

interface RejectInput {
  reviewNote: string;
}

export async function reject(
  refundId: string,
  actorId: string,
  input: RejectInput,
): Promise<RefundClaimDto> {
  if (!input.reviewNote || input.reviewNote.trim().length < 5) {
    throw new HttpError(400, "VALIDATION_ERROR", "Review note required when rejecting");
  }
  const r = await prisma.refund.findFirst({
    where: { id: refundId, kind: "DAMAGE_CLAIM" },
    include: { order: { select: { orderNumber: true, email: true } } },
  });
  if (!r) throw new HttpError(404, "REFUND_CLAIM_NOT_FOUND", "Claim not found");
  if (r.status !== "REQUESTED") {
    throw new HttpError(400, "REFUND_CLAIM_NOT_ACTIONABLE", "Claim already reviewed");
  }

  await prisma.refund.update({
    where: { id: refundId },
    data: {
      status: "REJECTED",
      reviewNote: input.reviewNote.trim(),
      reviewedByUserId: actorId,
      reviewedAt: new Date(),
    },
  });

  const dto = await detail(refundId);

  void sendMail({
    to: r.order.email,
    ...refundClaimRejectedEmail(dto, r.order.orderNumber),
  }).catch((e) => logger.error("refund claim rejection mail failed", e, { refundId }));

  return dto;
}

/**
 * After a refund settles (PROCESSED), reconcile the parent order:
 *   - If every captured rupee is now refunded → Order.REFUNDED + Payment.REFUNDED.
 *   - Else if no other refund is still in-flight → Order back to DELIVERED.
 *   - Else (other refunds still APPROVED/PENDING) → leave as REFUND_PROCESSING.
 *
 * Exported because the webhook handler also calls this when refund.processed
 * arrives asynchronously.
 */
export async function maybeFlipOrderToTerminalState(
  tx: Prisma.TransactionClient,
  orderId: string,
  actorId: string | null,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { totalPrice: true, status: true },
  });
  if (!order) return;

  const refunds = await tx.refund.findMany({
    where: { orderId },
    select: { status: true, amountPrice: true, paymentId: true },
  });

  const settled = refunds
    .filter((x) => x.status === "PROCESSED")
    .reduce((s, x) => s + x.amountPrice, 0);
  const inFlight = refunds.some(
    (x) => x.status === "APPROVED" || x.status === "PENDING" || x.status === "REQUESTED",
  );

  if (settled >= order.totalPrice) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "REFUNDED" },
    });
    const paymentIds = Array.from(new Set(refunds.map((r) => r.paymentId)));
    if (paymentIds.length > 0) {
      await tx.payment.updateMany({
        where: { id: { in: paymentIds } },
        data: { status: "REFUNDED" },
      });
    }
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "REFUNDED",
        note: "refund_fully_settled",
        createdByUserId: actorId,
      },
    });
    return;
  }

  if (!inFlight && order.status === "REFUND_PROCESSING") {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "DELIVERED" },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "DELIVERED",
        note: "refund_partial_settled",
        createdByUserId: actorId,
      },
    });
  }
}
