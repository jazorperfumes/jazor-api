import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { env } from "../env.js";
import { getShippingProvider } from "./shipping/index.js";
import type { CreateShipmentItem } from "./shipping/types.js";
import type {
  AdminOrderDetailDto,
  AdminOrderListItemDto,
  AdminOrderListQuery,
  AdminOrderListResponse,
  AdminOrderShipRequest,
  AdminOrderStatusEventDto,
  AdminOrderStatusRequest,
  AdminRateShopRequest,
  AdminRateShopResponse,
  AdminShipLiveRequest,
} from "../types/admin.js";
import type { I18nString, Collection, Family } from "../types/products.js";
import type { OrderStatus } from "../types/orders.js";

// ─── helpers ───────────────────────────────────────────────────────────────

interface ProductSnapshot {
  name: I18nString;
  slug: string | null;
  image: string | null;
  sizeMl: number;
  sku: string;
  collection: Collection;
  family: Family;
}

function readSnapshot(value: Prisma.JsonValue | null): ProductSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      name: { en: "", ar: "" },
      slug: null,
      image: null,
      sizeMl: 0,
      sku: "",
      collection: "FRENCH",
      family: "FLORAL",
    };
  }
  const v = value as Record<string, unknown>;
  const nameRaw = v.name && typeof v.name === "object" && !Array.isArray(v.name)
    ? (v.name as Record<string, unknown>)
    : null;
  return {
    name: nameRaw
      ? {
          en: typeof nameRaw.en === "string" ? nameRaw.en : "",
          ar: typeof nameRaw.ar === "string" ? nameRaw.ar : "",
        }
      : { en: "", ar: "" },
    slug: typeof v.slug === "string" ? v.slug : null,
    image: typeof v.image === "string" ? v.image : null,
    sizeMl: typeof v.sizeMl === "number" ? v.sizeMl : 0,
    sku: typeof v.sku === "string" ? v.sku : "",
    collection: (v.collection === "ARABIC" ? "ARABIC" : "FRENCH") as Collection,
    family: (typeof v.family === "string" ? v.family : "FLORAL") as Family,
  };
}

function readAddress(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      contactName: "",
      phone: "",
      line1: "",
      line2: null as string | null,
      city: "",
      state: "",
      pincode: "",
      country: "India",
    };
  }
  const v = value as Record<string, unknown>;
  return {
    contactName: typeof v.contactName === "string" ? v.contactName : "",
    phone: typeof v.phone === "string" ? v.phone : "",
    line1: typeof v.line1 === "string" ? v.line1 : "",
    line2: typeof v.line2 === "string" ? v.line2 : null,
    city: typeof v.city === "string" ? v.city : "",
    state: typeof v.state === "string" ? v.state : "",
    pincode: typeof v.pincode === "string" ? v.pincode : "",
    country: typeof v.country === "string" ? v.country : "India",
  };
}

// ─── list ──────────────────────────────────────────────────────────────────

export async function list(query: AdminOrderListQuery): Promise<AdminOrderListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const and: Prisma.OrderWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    and.push({
      OR: [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (query.from || query.to) {
    const range: Prisma.DateTimeFilter = {};
    if (query.from) range.gte = new Date(query.from);
    if (query.to) range.lte = new Date(query.to);
    and.push({ placedAt: range });
  }
  if (query.paymentStatus) {
    and.push({ payments: { some: { status: query.paymentStatus } } });
  }
  const where: Prisma.OrderWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip,
      take: pageSize,
      include: {
        _count: { select: { items: true } },
        payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
        user: { select: { name: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const items: AdminOrderListItemDto[] = rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.payments[0]?.status ?? null,
    email: o.email,
    customerName: o.user?.name ?? null,
    placedAt: o.placedAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    totalPrice: o.totalPrice,
    itemCount: o._count.items,
  }));

  return { items, page, pageSize, total };
}

// ─── detail ────────────────────────────────────────────────────────────────

export async function detail(orderId: string): Promise<AdminOrderDetailDto> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      shipments: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { email: true } } } },
      user: { select: { id: true, email: true, name: true, phone: true } },
      redemptions: { include: { promotion: { select: { name: true } } } },
    },
  });
  if (!o) throw new HttpError(404, "NOT_FOUND", "Order not found");

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    cancelledAt: o.cancelledAt ? o.cancelledAt.toISOString() : null,
    subtotalPrice: o.subtotalPrice,
    discountPrice: o.discountPrice,
    shippingPrice: o.shippingPrice,
    giftWrapPrice: o.giftWrapPrice,
    totalPrice: o.totalPrice,
    promotions: o.redemptions.map((r) => ({
      promotionId: r.promotionId,
      code: r.code,
      name: r.promotion.name,
      rewardType: r.rewardType,
      amountPrice: r.amountPrice,
    })),
    giftWrap: o.giftWrap,
    giftMessage: o.giftMessage,
    notes: o.notes,
    customer: {
      id: o.user?.id ?? null,
      email: o.user?.email ?? o.email,
      name: o.user?.name ?? null,
      phone: o.user?.phone ?? o.phone,
    },
    shippingAddress: readAddress(o.shippingAddress),
    items: o.items.map((i) => {
      const snap = readSnapshot(i.productSnapshot);
      return {
        id: i.id,
        variantId: i.variantId,
        name: snap.name,
        slug: snap.slug,
        image: snap.image,
        sizeMl: snap.sizeMl,
        sku: snap.sku,
        unitPrice: i.unitPrice,
        qty: i.qty,
        lineTotalPrice: i.lineTotalPrice,
      };
    }),
    payments: o.payments.map((p) => ({
      id: p.id,
      status: p.status,
      method: p.method,
      amountPrice: p.amountPrice,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
    })),
    shipments: o.shipments.map((s) => ({
      id: s.id,
      status: s.status,
      courier: s.courierName,
      awb: s.awb,
      trackingUrl: s.trackingUrl,
      weightGrams: s.weightGrams,
      shippedAt: s.shippedAt ? s.shippedAt.toISOString() : null,
      deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
      createdAt: s.createdAt.toISOString(),
    })),
    refunds: o.refunds.map((r) => ({
      id: r.id,
      status: r.status,
      kind: r.kind,
      reasonCode: r.reasonCode,
      amountPrice: r.amountPrice,
      reason: r.reason,
      userDescription: r.userDescription,
      reviewNote: r.reviewNote,
      providerRefundId: r.providerRefundId,
      orderItemId: r.orderItemId,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    })),
    events: o.events.map<AdminOrderStatusEventDto>((e) => ({
      id: e.id,
      status: e.status,
      note: e.note,
      actorEmail: e.actor?.email ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

// ─── status transition ────────────────────────────────────────────────────

const ALLOWED_NEXT: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ["PAID", "CANCELLED"],
  PAID: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  REFUND_PROCESSING: [],
  CANCELLED: [],
  REFUNDED: [],
};

export async function setStatus(
  orderId: string,
  actorId: string,
  input: AdminOrderStatusRequest,
): Promise<AdminOrderDetailDto> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!o) throw new HttpError(404, "NOT_FOUND", "Order not found");

  if (o.status === input.status) {
    return detail(orderId);
  }
  const allowed = ALLOWED_NEXT[o.status];
  if (!allowed.includes(input.status)) {
    throw new HttpError(
      400,
      "INVALID_STATUS_TRANSITION",
      `Cannot transition ${o.status} → ${input.status}`,
    );
  }
  if (input.status === "SHIPPED" && o.shipments.length === 0) {
    throw new HttpError(400, "INVALID_STATUS_TRANSITION", "Create shipment before SHIPPED");
  }

  await prisma.$transaction(async (tx) => {
    const data: Prisma.OrderUpdateInput = { status: input.status };
    if (input.status === "CANCELLED") data.cancelledAt = new Date();
    if (input.status === "PAID") data.paidAt = new Date();
    await tx.order.update({ where: { id: orderId }, data });
    // Admin marking DELIVERED is the only delivery signal for manual shipments
    // (no provider webhook fires). Stamp deliveredAt so the refund-claim window
    // opens — eligibility keys off shipment.deliveredAt, not order.status.
    if (input.status === "DELIVERED" && o.shipments[0] && !o.shipments[0].deliveredAt) {
      await tx.shipment.update({
        where: { id: o.shipments[0].id },
        data: { status: "DELIVERED", deliveredAt: new Date() },
      });
    }
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: input.status,
        note: input.note ?? null,
        createdByUserId: actorId,
      },
    });
  });

  return detail(orderId);
}

// ─── shipping provider: rate-shop ─────────────────────────────────────────

export async function rateShop(
  orderId: string,
  input: AdminRateShopRequest,
): Promise<AdminRateShopResponse> {
  if (env.SHIPPING_PROVIDER === "manual") {
    return { providerEnabled: false, options: [] };
  }
  const provider = getShippingProvider();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, totalPrice: true, shippingAddress: true, status: true },
  });
  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");

  const pickup = await prisma.pickupAddress.findUnique({ where: { id: input.pickupAddressId } });
  if (!pickup) throw new HttpError(400, "PICKUP_ADDRESS_REQUIRED", "Pickup address not found");

  const addr = readAddress(order.shippingAddress);
  if (!addr.pincode) {
    throw new HttpError(400, "ADDRESS_INVALID", "Order is missing a delivery pincode");
  }

  const options = await provider.rateShop({
    pickupPincode: pickup.pincode,
    deliveryPincode: addr.pincode,
    weightG: input.weightGrams,
    lengthCm: input.lengthCm,
    breadthCm: input.breadthCm,
    heightCm: input.heightCm,
    declaredValuePaise: order.totalPrice,
  });

  return { providerEnabled: true, options };
}

// ─── shipping provider: live ship ─────────────────────────────────────────

export async function liveShip(
  orderId: string,
  actorId: string,
  input: AdminShipLiveRequest,
): Promise<AdminOrderDetailDto> {
  if (env.SHIPPING_PROVIDER === "manual") {
    throw new HttpError(503, "SHIPMENT_PROVIDER_DISABLED", "Live shipping disabled");
  }
  const provider = getShippingProvider();

  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      shipments: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!o) throw new HttpError(404, "NOT_FOUND", "Order not found");
  if (o.status !== "PAID" && o.status !== "PACKED") {
    throw new HttpError(400, "INVALID_STATUS_TRANSITION", "Order must be PAID or PACKED to ship");
  }
  if (o.shipments.length > 0 && o.shipments[0].status !== "CANCELLED") {
    throw new HttpError(409, "SHIPMENT_EXISTS", "Shipment already exists for this order");
  }

  const pickup = await prisma.pickupAddress.findUnique({ where: { id: input.pickupAddressId } });
  if (!pickup) throw new HttpError(400, "PICKUP_ADDRESS_REQUIRED", "Pickup address not found");
  if (!pickup.providerPickupId) {
    throw new HttpError(
      400,
      "PICKUP_ADDRESS_REQUIRED",
      "Pickup address has no warehouse ID — register it in your shipping provider dashboard first",
    );
  }

  const addr = readAddress(o.shippingAddress);

  const items: CreateShipmentItem[] = o.items.map((it) => {
    const snap = readSnapshot(it.productSnapshot);
    const name = snap.name.en || snap.name.ar || "Item";
    return {
      name: `${name} (${snap.sizeMl}ml)`,
      sku: snap.sku || it.variantId || it.id,
      units: it.qty,
      sellingPrice: it.unitPrice,
    };
  });

  const result = await provider.createShipment({
    orderNumber: o.orderNumber,
    orderDate: o.placedAt.toISOString().slice(0, 10),
    pickup: {
      locationId: pickup.providerPickupId,
      contactName: pickup.contactName,
      phone: pickup.phone,
      email: null,
      line1: pickup.line1,
      line2: pickup.line2,
      city: pickup.city,
      state: pickup.state,
      pincode: pickup.pincode,
      country: pickup.country,
    },
    billing: {
      customerName: addr.contactName || o.email,
      address: addr.line1,
      line2: addr.line2,
      city: addr.city,
      pincode: addr.pincode,
      state: addr.state,
      country: addr.country || "India",
      phone: addr.phone || o.phone,
      email: o.email,
    },
    items,
    subTotal: o.subtotalPrice,
    weightG: input.weightGrams,
    lengthCm: input.lengthCm,
    breadthCm: input.breadthCm,
    heightCm: input.heightCm,
    courierId: input.courierId,
  });

  await prisma.$transaction(async (tx) => {
    await tx.shipment.create({
      data: {
        orderId,
        provider: provider.name,
        providerShipmentId: result.providerShipmentId,
        awb: result.awb,
        courierName: result.courierName,
        courierServiceId: String(result.courierId),
        trackingUrl: result.trackingUrl,
        labelUrl: result.labelUrl,
        pickupAddressId: pickup.id,
        weightGrams: input.weightGrams,
        lengthCm: input.lengthCm,
        breadthCm: input.breadthCm,
        heightCm: input.heightCm,
        shippingChargePrice: result.freightChargesPrice,
        codAmountPrice: result.codChargesPrice,
        status: "MANIFESTED",
        shippedAt: new Date(),
        rawPayload: result.raw as Prisma.InputJsonValue,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: "SHIPPED" },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "SHIPPED",
        note: `${provider.name} awb=${result.awb} courier=${result.courierName}`,
        createdByUserId: actorId,
      },
    });
  });

  return detail(orderId);
}

// ─── cancel shipment ──────────────────────────────────────────────────────

export async function cancelShipment(
  shipmentId: string,
  reason: string,
): Promise<AdminOrderDetailDto> {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment) throw new HttpError(404, "NOT_FOUND", "Shipment not found");

  const cancelableStatuses: typeof shipment.status[] = ["CREATED", "MANIFESTED", "PICKED_UP"];
  if (!cancelableStatuses.includes(shipment.status)) {
    throw new HttpError(
      400,
      "SHIPMENT_NOT_CANCELABLE",
      `Cannot cancel shipment in status ${shipment.status}`,
    );
  }

  // Only call provider for non-manual shipments where it's the currently
  // configured one. Cross-provider cancellation (e.g. a stale shipprime row
  // after migration to nimbuspost) falls back to local-only cancel.
  if (
    shipment.provider !== "manual" &&
    shipment.awb &&
    env.SHIPPING_PROVIDER !== "manual" &&
    shipment.provider === env.SHIPPING_PROVIDER
  ) {
    const provider = getShippingProvider();
    const result = await provider.cancelShipment(shipment.awb, reason || "admin_cancel");
    if (!result.cancelled.includes(shipment.awb)) {
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        `${provider.name} did not confirm cancellation`,
      );
    }
  }

  // Order status intentionally untouched — admin manually reverts PACKED if
  // re-shipping. Shipment.cancelledAt is the audit anchor; no OrderStatusEvent
  // since the enum has no "shipment_cancelled" variant.
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });

  return detail(shipment.orderId);
}

export async function manualShip(
  orderId: string,
  actorId: string,
  input: AdminOrderShipRequest,
): Promise<AdminOrderDetailDto> {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    include: { shipments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!o) throw new HttpError(404, "NOT_FOUND", "Order not found");
  if (o.status !== "PAID" && o.status !== "PACKED") {
    throw new HttpError(400, "INVALID_STATUS_TRANSITION", "Order must be PAID or PACKED to ship");
  }
  if (o.shipments.length > 0 && o.shipments[0].status !== "CANCELLED") {
    throw new HttpError(409, "SHIPMENT_EXISTS", "Shipment already exists for this order");
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.create({
      data: {
        orderId,
        provider: "manual",
        courierName: input.courierName,
        awb: input.awb,
        trackingUrl: input.trackingUrl ?? null,
        weightGrams: input.weightGrams ?? null,
        lengthCm: input.lengthCm ?? null,
        breadthCm: input.breadthCm ?? null,
        heightCm: input.heightCm ?? null,
        pickupAddressId: input.pickupAddressId ?? null,
        status: "MANIFESTED",
        shippedAt: new Date(),
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: "SHIPPED" },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId,
        status: "SHIPPED",
        note: `manual_ship awb=${input.awb}`,
        createdByUserId: actorId,
      },
    });
  });

  return detail(orderId);
}
