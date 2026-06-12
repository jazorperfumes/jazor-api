import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import * as ordersService from "./ordersService.js";
import * as razorpayService from "./razorpayService.js";
import { generateInvoice } from "./invoiceService.js";
import { sendMail, orderCancellationEmail } from "./mailService.js";
import type { OrderDetailDto, OrderStatus } from "../types/orders.js";
import type { I18nString } from "../types/products.js";
import type {
  CancelOrderResponse,
  CancelRefundStatus,
  OrderListItemDto,
  OrderListPreviewItemDto,
  OrderListQuery,
  OrderListResponse,
} from "../types/accountOrders.js";

const CANCELLABLE_STATUSES = new Set<OrderStatus>(["CREATED", "PAID", "PACKED"]);
const SHIPPED_LIKE = new Set([
  "MANIFESTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
]);

function jsonToI18n(value: Prisma.JsonValue | null): I18nString {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return {
      en: typeof v.en === "string" ? v.en : "",
      ar: typeof v.ar === "string" ? v.ar : "",
    };
  }
  return { en: "", ar: "" };
}

function readSnapshotPreview(value: Prisma.JsonValue | null): {
  name: I18nString;
  image: string | null;
  sizeMl: number;
  slug: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { name: { en: "", ar: "" }, image: null, sizeMl: 0, slug: "" };
  }
  const v = value as Record<string, unknown>;
  return {
    name: jsonToI18n(v.name as Prisma.JsonValue),
    image: typeof v.image === "string" ? v.image : null,
    sizeMl: typeof v.sizeMl === "number" ? v.sizeMl : 0,
    slug: typeof v.slug === "string" ? v.slug : "",
  };
}

export async function list(userId: string, query: OrderListQuery): Promise<OrderListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 50);
  const skip = (page - 1) * pageSize;

  const where: Prisma.OrderWhereInput = {
    userId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        items: { orderBy: { createdAt: "asc" }, take: 2 },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const items: OrderListItemDto[] = rows.map((o) => {
    const previewItems: OrderListPreviewItemDto[] = o.items.map((i) => {
      const snap = readSnapshotPreview(i.productSnapshot);
      return {
        name: snap.name,
        image: snap.image,
        sizeMl: snap.sizeMl,
        qty: i.qty,
        slug: snap.slug,
      };
    });
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      placedAt: o.placedAt.toISOString(),
      totalPrice: o.totalPrice,
      itemCount: o._count.items,
      previewItems,
    };
  });

  return { items, page, pageSize, total };
}

export function get(orderId: string, userId: string): Promise<OrderDetailDto> {
  return ordersService.get(orderId, userId);
}

export async function invoiceBuffer(orderId: string, userId: string): Promise<{
  buffer: Buffer;
  orderNumber: string;
}> {
  const detail = await ordersService.get(orderId, userId);
  if (detail.status === "CREATED") {
    throw new HttpError(400, "ORDER_NOT_CANCELABLE", "Invoice available after payment");
  }
  const buffer = await generateInvoice(detail);
  return { buffer, orderNumber: detail.orderNumber };
}

export async function cancel(orderId: string, userId: string): Promise<CancelOrderResponse> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: {
      items: { select: { id: true, variantId: true, qty: true } },
      payments: {
        where: { status: "CAPTURED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");

  if (!CANCELLABLE_STATUSES.has(order.status)) {
    throw new HttpError(400, "ORDER_NOT_CANCELABLE", "Order can no longer be cancelled");
  }
  const lastShipment = order.shipments[0];
  if (lastShipment && SHIPPED_LIKE.has(lastShipment.status)) {
    throw new HttpError(400, "ORDER_NOT_CANCELABLE", "Order already shipped");
  }

  const capturedPayment = order.payments[0] ?? null;

  // Razorpay refund call sits outside the DB tx — never hold row locks across a
  // network round trip. Failure is captured + persisted as Refund FAILED so the
  // cancel still completes; admin / webhook can reconcile later.
  let refundResult: {
    status: CancelRefundStatus;
    providerRefundId: string | null;
  } = { status: "NONE", providerRefundId: null };

  if (capturedPayment?.providerPaymentId) {
    try {
      const r = await razorpayService.refundPayment({
        providerPaymentId: capturedPayment.providerPaymentId,
        amountPaise: order.totalPrice,
        notes: { orderId: order.id, orderNumber: order.orderNumber },
      });
      refundResult = { status: r.status, providerRefundId: r.providerRefundId };
    } catch (err) {
      logger.error("refund call failed", err as Error, { orderId: order.id });
      refundResult = { status: "FAILED", providerRefundId: null };
    }
  }

  await prisma.$transaction(async (tx) => {
    // Re-check status inside tx to defend against a concurrent admin transition
    // (e.g. PACKED → SHIPPED) between our initial read and the cancel write.
    const fresh = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    if (!fresh || !CANCELLABLE_STATUSES.has(fresh.status)) {
      throw new HttpError(409, "ORDER_NOT_CANCELABLE", "Order state changed");
    }

    for (const item of order.items) {
      if (!item.variantId) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
      const after = await tx.productVariant.findUnique({
        where: { id: item.variantId },
        select: { stock: true },
      });
      await tx.inventoryAdjustment.create({
        data: {
          variantId: item.variantId,
          delta: item.qty,
          newStock: after?.stock ?? item.qty,
          reason: "cancel_restock",
          refOrderId: order.id,
          performedByUserId: userId,
        },
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    // Release every promotion this order consumed. Committed redemptions bumped
    // Promotion.usedCount on capture, so unwind those before deleting the rows;
    // uncommitted rows (never-paid) only need deletion.
    const redemptions = await tx.promotionRedemption.findMany({
      where: { orderId: order.id },
      select: { id: true, promotionId: true, committed: true },
    });
    for (const r of redemptions) {
      if (r.committed) {
        await tx.promotion.update({
          where: { id: r.promotionId },
          data: { usedCount: { decrement: 1 } },
        });
      }
    }
    if (redemptions.length > 0) {
      await tx.promotionRedemption.deleteMany({ where: { orderId: order.id } });
    }

    if (capturedPayment) {
      await tx.refund.create({
        data: {
          paymentId: capturedPayment.id,
          orderId: order.id,
          kind: "PRE_SHIP_CANCEL",
          providerRefundId: refundResult.providerRefundId,
          amountPrice: order.totalPrice,
          status:
            refundResult.status === "PROCESSED"
              ? "PROCESSED"
              : refundResult.status === "FAILED"
                ? "FAILED"
                : "PENDING",
          reason: "user_cancel",
          createdByUserId: userId,
          processedAt: refundResult.status === "PROCESSED" ? new Date() : null,
        },
      });
      if (refundResult.status === "PROCESSED") {
        await tx.payment.update({
          where: { id: capturedPayment.id },
          data: { status: "REFUNDED" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "REFUNDED" },
        });
      }
    }

    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: refundResult.status === "PROCESSED" ? "REFUNDED" : "CANCELLED",
        note: capturedPayment ? `user_cancel_refund_${refundResult.status.toLowerCase()}` : "user_cancel",
        createdByUserId: userId,
      },
    });
  });

  // Fire-and-forget cancellation email; failure must not bubble to the user.
  void (async () => {
    try {
      const detail = await ordersService.get(order.id, userId);
      const tmpl = orderCancellationEmail(detail, refundResult.status);
      await sendMail({ to: order.email, ...tmpl });
    } catch (err) {
      logger.error("cancellation mail failed", err as Error, { orderId: order.id });
    }
  })();

  const finalStatus: OrderStatus = refundResult.status === "PROCESSED" ? "REFUNDED" : "CANCELLED";
  return {
    orderId: order.id,
    status: finalStatus,
    refund: {
      status: refundResult.status,
      amountPrice: capturedPayment ? order.totalPrice : undefined,
    },
  };
}
