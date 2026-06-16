import { Prisma } from "@prisma/client";
import { customAlphabet } from "nanoid";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { env } from "../env.js";
import * as checkoutService from "./checkoutService.js";
import * as razorpayService from "./razorpayService.js";
import { generateInvoice } from "./invoiceService.js";
import {
  sendMail,
  orderConfirmationEmail,
  adminOrderAlertEmail,
  adminPaidAfterCancelEmail,
} from "./mailService.js";
import { normalizeCountry } from "../utils/country.js";
import * as addressService from "./addressService.js";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  OrderAddressDto,
  OrderDetailDto,
  OrderItemDto,
  OrderPaymentDto,
  OrderShipmentSummaryDto,
} from "../types/orders.js";
import type { AddressInput } from "../types/address.js";
import type { I18nString, Collection, Family } from "../types/products.js";

// ─── address resolution ───────────────────────────────────────────────────

interface ResolvedAddress {
  snapshot: AddressInput;
  saveAfter?: { input: AddressInput; setDefault: boolean };
}

const PINCODE_RE = /^[0-9]{6}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

function validateAddressShape(a: AddressInput): void {
  if (!a.contactName?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "Contact name required");
  if (!a.line1?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "Address line 1 required");
  if (!a.city?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "City required");
  if (!a.state?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "State required");
  if (!PINCODE_RE.test(a.pincode)) throw new HttpError(400, "ADDRESS_INVALID", "Invalid pincode");
  if (!PHONE_RE.test(a.phone)) throw new HttpError(400, "ADDRESS_INVALID", "Invalid phone");
}

async function resolveAddress(
  userId: string,
  input: CreateOrderRequest,
): Promise<ResolvedAddress> {
  if (input.shippingAddressId) {
    const a = await prisma.address.findFirst({
      where: { id: input.shippingAddressId, userId },
    });
    if (!a) throw new HttpError(400, "ADDRESS_INVALID", "Saved address not found");
    return {
      snapshot: {
        label: a.label ?? undefined,
        contactName: a.contactName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2 ?? undefined,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        country: normalizeCountry(a.country),
      },
    };
  }
  if (input.shippingAddress) {
    const a: AddressInput = {
      ...input.shippingAddress,
      country: normalizeCountry(input.shippingAddress.country),
    };
    validateAddressShape(a);
    return {
      snapshot: a,
      saveAfter: input.saveAddress
        ? { input: a, setDefault: Boolean(input.setDefaultAddress) }
        : undefined,
    };
  }
  throw new HttpError(400, "ADDRESS_INVALID", "Shipping address required");
}

// ─── order number ─────────────────────────────────────────────────────────

const ORDER_SUFFIX = customAlphabet("0123456789ABCDEFGHJKLMNPQRSTUVWXYZ", 6);

function generateOrderNumber(): string {
  const d = new Date();
  const yyyymmdd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `JZ-${yyyymmdd}-${ORDER_SUFFIX()}`;
}

// ─── DTO mappers ──────────────────────────────────────────────────────────

interface ProductSnapshot {
  name: I18nString;
  slug: string;
  image: string | null;
  sizeMl: number;
  sku: string;
  collection: Collection;
  family: Family;
}

function readSnapshot(value: Prisma.JsonValue | null): ProductSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const nameRaw = v.name && typeof v.name === "object" && !Array.isArray(v.name)
    ? (v.name as Record<string, unknown>)
    : null;
  const name: I18nString = nameRaw
    ? {
        en: typeof nameRaw.en === "string" ? nameRaw.en : "",
        ar: typeof nameRaw.ar === "string" ? nameRaw.ar : "",
      }
    : { en: "", ar: "" };
  return {
    name,
    slug: typeof v.slug === "string" ? v.slug : "",
    image: typeof v.image === "string" ? v.image : null,
    sizeMl: typeof v.sizeMl === "number" ? v.sizeMl : 0,
    sku: typeof v.sku === "string" ? v.sku : "",
    collection: (v.collection === "ARABIC" ? "ARABIC" : "FRENCH") as Collection,
    family: (typeof v.family === "string" ? v.family : "FLORAL") as Family,
  };
}

function readAddress(value: Prisma.JsonValue | null): OrderAddressDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      contactName: "",
      phone: "",
      line1: "",
      line2: null,
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

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: {
    items: { include: { review: { select: { id: true } } } };
    payments: { orderBy: { createdAt: "desc" }; take: 1 };
    shipments: { orderBy: { createdAt: "desc" }; take: 1 };
    redemptions: { include: { promotion: { select: { name: true } } } };
  };
}>;

function toOrderItemDto(item: OrderWithRelations["items"][number]): OrderItemDto {
  const snap = readSnapshot(item.productSnapshot);
  return {
    id: item.id,
    variantId: item.variantId,
    name: snap?.name ?? { en: "", ar: "" },
    slug: snap?.slug ?? null,
    image: snap?.image ?? null,
    sizeMl: snap?.sizeMl ?? 0,
    sku: snap?.sku ?? "",
    collection: snap?.collection ?? "FRENCH",
    family: snap?.family ?? "FLORAL",
    unitPrice: item.unitPrice,
    qty: item.qty,
    lineTotalPrice: item.lineTotalPrice,
    isGift: item.isGift,
    hasReview: Boolean(item.review),
  };
}

function toPaymentDto(p: OrderWithRelations["payments"][number] | undefined): OrderPaymentDto | null {
  if (!p) return null;
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    amountPrice: p.amountPrice,
    capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
  };
}

function toShipmentDto(s: OrderWithRelations["shipments"][number] | undefined): OrderShipmentSummaryDto | null {
  if (!s) return null;
  return {
    id: s.id,
    status: s.status,
    courier: s.courierName,
    awb: s.awb,
    trackingUrl: s.trackingUrl,
    shippedAt: s.shippedAt ? s.shippedAt.toISOString() : null,
    deliveredAt: s.deliveredAt ? s.deliveredAt.toISOString() : null,
  };
}

function toOrderDetailDto(order: OrderWithRelations): OrderDetailDto {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    cancelledAt: order.cancelledAt ? order.cancelledAt.toISOString() : null,
    email: order.email,
    phone: order.phone,
    shippingAddress: readAddress(order.shippingAddress),
    giftWrap: order.giftWrap,
    giftMessage: order.giftMessage,
    notes: order.notes,
    items: order.items.map(toOrderItemDto),
    subtotalPrice: order.subtotalPrice,
    discountPrice: order.discountPrice,
    shippingPrice: order.shippingPrice,
    giftWrapPrice: order.giftWrapPrice,
    totalPrice: order.totalPrice,
    promotions: order.redemptions.map((r) => ({
      promotionId: r.promotionId,
      code: r.code,
      name: r.promotion.name,
      rewardType: r.rewardType,
      amountPrice: r.amountPrice,
    })),
    payment: toPaymentDto(order.payments[0]),
    shipment: toShipmentDto(order.shipments[0]),
  };
}

const orderDetailInclude = {
  items: { include: { review: { select: { id: true } } } },
  payments: { orderBy: { createdAt: "desc" }, take: 1 },
  shipments: { orderBy: { createdAt: "desc" }, take: 1 },
  redemptions: { include: { promotion: { select: { name: true } } } },
} satisfies Prisma.OrderInclude;

// ─── promotion redemption commit ──────────────────────────────────────────

/**
 * Flips this order's redemptions to committed + bumps each promo's usedCount.
 * Idempotent: only uncommitted rows are counted, so a webhook + verify race
 * never double-increments.
 */
async function commitRedemptions(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const pending = await tx.promotionRedemption.findMany({
    where: { orderId, committed: false },
    select: { id: true, promotionId: true },
  });
  if (pending.length === 0) return;
  for (const r of pending) {
    await tx.promotion.update({
      where: { id: r.promotionId },
      data: { usedCount: { increment: 1 } },
    });
  }
  await tx.promotionRedemption.updateMany({
    where: { orderId, committed: false },
    data: { committed: true },
  });
}

// ─── create ───────────────────────────────────────────────────────────────

export async function create(
  userId: string,
  input: CreateOrderRequest,
): Promise<CreateOrderResponse> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, phone: true },
  });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");

  const address = await resolveAddress(userId, input);

  // Re-quote server-side. Never trust client totals.
  const { quote, engine, cart } = await checkoutService.quoteDetailed(userId, {
    discountCodes: input.discountCodes,
    giftSelections: input.giftSelections,
    giftWrap: input.giftWrap ?? false,
  });

  if (quote.issues.includes("CART_EMPTY") || cart.items.length === 0) {
    throw new HttpError(400, "CART_EMPTY", "Your cart is empty");
  }
  if (quote.issues.includes("OUT_OF_STOCK")) {
    const oosItems = quote.items
      .filter((i) => !i.inStock)
      .map((i) => ({ variantId: i.variantId, availableStock: i.availableStock, requestedQty: i.qty }));
    throw new HttpError(409, "OUT_OF_STOCK", "One or more items are out of stock", { items: oosItems });
  }
  // Block only on hard rejections (bad/expired/limit/min-order). A NOT_ELIGIBLE
  // code was merely dropped by stacking rules — let the order proceed without it.
  const hardRejects = quote.rejectedCodes.filter((r) => r.reason !== "NOT_ELIGIBLE");
  if ((input.discountCodes?.length ?? 0) > 0 && hardRejects.length > 0) {
    throw new HttpError(400, "PROMOTION_INVALID", "A discount code could not be applied", {
      rejected: hardRejects,
    });
  }

  const giftLines = engine?.giftLines ?? [];
  const resolved = engine?.resolved ?? [];

  const orderNumber = generateOrderNumber();

  // Unified reserve list: paid cart lines + free BxGy gift lines (qty 1, free).
  const reserveList = [
    ...cart.items.map((i) => ({
      variantId: i.variantId,
      qty: i.qty,
      availableStock: i.availableStock,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      isGift: false,
      snapshot: {
        name: i.name,
        slug: i.slug,
        image: i.image,
        sizeMl: i.sizeMl,
        sku: i.sku,
        collection: i.collection,
        family: i.family,
      },
    })),
    ...giftLines.map((g) => ({
      variantId: g.variantId,
      qty: 1,
      availableStock: g.availableStock,
      unitPrice: 0,
      lineTotal: 0,
      isGift: true,
      snapshot: {
        name: g.name,
        slug: g.slug,
        image: g.image,
        sizeMl: g.sizeMl,
        sku: g.sku,
        collection: g.collection,
        family: g.family,
      },
    })),
  ];

  const result = await prisma.$transaction(async (tx) => {
    // Atomic stock reserve. updateMany predicate enforces availability — count
    // !== 1 means another order grabbed the stock between quote and tx.
    for (const item of reserveList) {
      const r = await tx.productVariant.updateMany({
        where: {
          id: item.variantId,
          stock: { gte: item.qty },
          isActive: true,
          deletedAt: null,
        },
        data: { stock: { decrement: item.qty } },
      });
      if (r.count !== 1) {
        throw new HttpError(409, "OUT_OF_STOCK", "Stock changed before order created", {
          items: [{ variantId: item.variantId, requestedQty: item.qty }],
        });
      }
    }

    const order = await tx.order.create({
      data: {
        orderNumber,
        userId,
        email: user.email,
        phone: address.snapshot.phone,
        status: "CREATED",
        subtotalPrice: quote.subtotalPrice,
        discountPrice: quote.discountPrice,
        shippingPrice: quote.shippingPrice,
        giftWrapPrice: quote.giftWrapPrice,
        taxPrice: 0,
        totalPrice: quote.totalPrice,
        currency: "INR",
        giftWrap: input.giftWrap ?? false,
        giftMessage: input.giftMessage ?? null,
        shippingAddress: address.snapshot as unknown as Prisma.InputJsonValue,
        notes: input.notes ?? null,
        placedAt: new Date(),
      },
    });

    await tx.orderItem.createMany({
      data: reserveList.map((i) => ({
        orderId: order.id,
        variantId: i.variantId,
        productSnapshot: i.snapshot as unknown as Prisma.InputJsonValue,
        unitPrice: i.unitPrice,
        qty: i.qty,
        lineTotalPrice: i.lineTotal,
        isGift: i.isGift,
      })),
    });

    await tx.inventoryAdjustment.createMany({
      data: reserveList.map((i) => ({
        variantId: i.variantId,
        delta: -i.qty,
        newStock: Math.max(0, i.availableStock - i.qty),
        reason: "order_placed",
        refOrderId: order.id,
        performedByUserId: userId,
      })),
    });

    if (resolved.length > 0) {
      await tx.promotionRedemption.createMany({
        data: resolved.map((r) => ({
          promotionId: r.promotionId,
          orderId: order.id,
          userId,
          rewardType: r.rewardType,
          code: r.code,
          amountPrice: r.amountPrice,
          giftVariantId: r.giftVariantId,
          committed: false,
        })),
      });
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "razorpay",
        amountPrice: quote.totalPrice,
        currency: "INR",
        status: "CREATED",
      },
    });

    await tx.orderStatusEvent.create({
      data: { orderId: order.id, status: "CREATED", note: null },
    });

    return { order, payment };
  });

  if (address.saveAfter) {
    try {
      await addressService.create(userId, {
        ...address.saveAfter.input,
        setDefault: address.saveAfter.setDefault,
      });
    } catch (err) {
      // Saving address must not fail the order. Cap (ADDRESS_LIMIT) or transient
      // errors are logged and swallowed; order proceeds.
      logger.warn("save address after order failed", {
        orderId: result.order.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Razorpay REST is intentionally outside the tx to avoid holding locks across
  // a network call. If this fails, the reaper cancels the Order + restores
  // stock after ORDER_CREATED_TTL_MIN.
  const razorpayOrderId = await razorpayService.createOrder({
    amountPaise: quote.totalPrice,
    receipt: orderNumber,
    notes: { orderId: result.order.id },
  });

  await prisma.payment.update({
    where: { id: result.payment.id },
    data: { providerOrderId: razorpayOrderId },
  });

  return {
    orderId: result.order.id,
    orderNumber: result.order.orderNumber,
    razorpayOrderId,
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    amountPaise: quote.totalPrice,
    currency: "INR",
    prefill: {
      email: user.email,
      name: user.name ?? address.snapshot.contactName,
      contact: address.snapshot.phone,
    },
  };
}

// ─── get (ownership) ─────────────────────────────────────────────────────

export async function get(orderId: string, userId: string): Promise<OrderDetailDto> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: orderDetailInclude,
  });
  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");
  return toOrderDetailDto(order);
}

async function loadOrderDetail(orderId: string): Promise<OrderDetailDto | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: orderDetailInclude,
  });
  return order ? toOrderDetailDto(order) : null;
}

// ─── verify ──────────────────────────────────────────────────────────────

interface VerifyInput {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export async function verifyAndCapture(
  userId: string,
  input: VerifyInput,
): Promise<{ orderId: string; orderNumber: string }> {
  const order = await prisma.order.findFirst({
    where: { id: input.orderId, userId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      userId: true,
      payments: { where: { providerOrderId: input.razorpayOrderId }, take: 1 },
    },
  });
  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");
  const payment = order.payments[0];
  if (!payment) throw new HttpError(400, "SIGNATURE_INVALID", "Payment not found for order");

  if (
    !razorpayService.verifyPaymentSignature({
      razorpayOrderId: input.razorpayOrderId,
      razorpayPaymentId: input.razorpayPaymentId,
      signature: input.razorpaySignature,
    })
  ) {
    throw new HttpError(400, "SIGNATURE_INVALID", "Payment signature invalid");
  }

  // Idempotent — if order is already PAID (e.g. webhook beat us), no-op.
  if (order.status === "PAID") {
    return { orderId: order.id, orderNumber: order.orderNumber };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Atomic flip: only a still-CREATED order becomes PAID. Guards the race
    // where the reaper cancelled (and restored stock) between our read and this
    // write — flipping a CANCELLED order to PAID would silently oversell.
    const flipped = await tx.order.updateMany({
      where: { id: order.id, status: "CREATED" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (flipped.count === 1) {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: input.razorpayPaymentId,
          providerSignature: input.razorpaySignature,
          status: "CAPTURED",
          capturedAt: new Date(),
        },
      });
      await commitRedemptions(tx, order.id);
      // Clear the user's cart now that payment is captured.
      const cart = await tx.cart.findUnique({ where: { userId } });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      }
      await tx.orderStatusEvent.create({
        data: { orderId: order.id, status: "PAID", note: "payment_captured" },
      });
      return "PAID" as const;
    }

    // Not CREATED. Either the webhook already marked it PAID, or the reaper
    // cancelled it. Re-read to decide.
    const current = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    if (current?.status === "PAID") return "ALREADY_PAID" as const;

    // Payment captured on a cancelled/dead order. Record the capture + flag for
    // manual reconciliation; do NOT mark PAID (stock was already restored).
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        providerPaymentId: input.razorpayPaymentId,
        providerSignature: input.razorpaySignature,
        status: "CAPTURED",
        capturedAt: new Date(),
      },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId: order.id,
        status: current?.status ?? "CANCELLED",
        note: "paid_after_cancel",
      },
    });
    return "PAID_AFTER_CANCEL" as const;
  });

  // Fire-and-forget side effects: emails. Failure here must NOT fail verify.
  if (outcome === "PAID") {
    void sendOrderConfirmation(order.id).catch((e) =>
      logger.error("order confirmation mail failed", e, { orderId: order.id }),
    );
    void sendAdminAlert(order.id).catch((e) =>
      logger.error("admin alert mail failed", e, { orderId: order.id }),
    );
  } else if (outcome === "PAID_AFTER_CANCEL") {
    logger.error(
      "payment captured on non-CREATED order",
      new Error("paid_after_cancel"),
      { orderId: order.id },
    );
    void sendPaidAfterCancelAlert(order.id).catch((e) =>
      logger.error("paid-after-cancel alert mail failed", e, { orderId: order.id }),
    );
  }

  return { orderId: order.id, orderNumber: order.orderNumber };
}

async function sendOrderConfirmation(orderId: string): Promise<void> {
  const order = await loadOrderDetail(orderId);
  if (!order) return;
  const pdf = await generateInvoice(order);
  const tmpl = orderConfirmationEmail(order);
  await sendMail({
    to: order.email,
    ...tmpl,
    attachments: [
      {
        filename: `jazor-${order.orderNumber}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });
}

async function sendAdminAlert(orderId: string): Promise<void> {
  const order = await loadOrderDetail(orderId);
  if (!order) return;
  const tmpl = adminOrderAlertEmail(order);
  await sendMail({ to: env.ADMIN_ALERT_EMAIL, ...tmpl });
}

/** Money captured on an order that was already cancelled (reaper race). Needs a human. */
async function sendPaidAfterCancelAlert(orderId: string): Promise<void> {
  const order = await loadOrderDetail(orderId);
  if (!order) return;
  const tmpl = adminPaidAfterCancelEmail(order);
  await sendMail({ to: env.ADMIN_ALERT_EMAIL, ...tmpl });
}

// ─── webhook handlers ────────────────────────────────────────────────────

interface WebhookPaymentEntity {
  id?: string;
  order_id?: string;
  method?: string;
  error_code?: string;
  error_description?: string;
}

interface WebhookRefundEntity {
  id?: string;
  payment_id?: string;
  amount?: number;
}

export async function handlePaymentCaptured(payment: WebhookPaymentEntity): Promise<void> {
  if (!payment.order_id || !payment.id) return;
  const p = await prisma.payment.findFirst({
    where: { providerOrderId: payment.order_id },
    select: {
      id: true,
      orderId: true,
      status: true,
      order: { select: { userId: true, status: true } },
    },
  });
  if (!p) return;
  if (p.order.status === "PAID") {
    // Order already settled (verify beat us); just ensure the payment row reflects capture.
    if (p.status !== "CAPTURED") {
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          providerPaymentId: payment.id ?? null,
          status: "CAPTURED",
          method: payment.method ?? null,
          capturedAt: new Date(),
        },
      });
    }
    return;
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // Atomic flip — only a still-CREATED order becomes PAID (see verifyAndCapture).
    const flipped = await tx.order.updateMany({
      where: { id: p.orderId, status: "CREATED" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (flipped.count === 1) {
      await tx.payment.update({
        where: { id: p.id },
        data: {
          providerPaymentId: payment.id ?? null,
          status: "CAPTURED",
          method: payment.method ?? null,
          capturedAt: new Date(),
        },
      });
      await commitRedemptions(tx, p.orderId);
      if (p.order.userId) {
        const cart = await tx.cart.findUnique({ where: { userId: p.order.userId } });
        if (cart) {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        }
      }
      await tx.orderStatusEvent.create({
        data: { orderId: p.orderId, status: "PAID", note: "webhook_payment_captured" },
      });
      return "PAID" as const;
    }

    const current = await tx.order.findUnique({
      where: { id: p.orderId },
      select: { status: true },
    });
    if (current?.status === "PAID") return "ALREADY_PAID" as const;

    // Captured on a cancelled/dead order — record capture, flag for manual
    // reconciliation, do NOT mark PAID (stock already restored by reaper).
    await tx.payment.update({
      where: { id: p.id },
      data: {
        providerPaymentId: payment.id ?? null,
        status: "CAPTURED",
        method: payment.method ?? null,
        capturedAt: new Date(),
      },
    });
    await tx.orderStatusEvent.create({
      data: {
        orderId: p.orderId,
        status: current?.status ?? "CANCELLED",
        note: "paid_after_cancel",
      },
    });
    return "PAID_AFTER_CANCEL" as const;
  });

  if (outcome === "PAID") {
    void sendOrderConfirmation(p.orderId).catch((e) =>
      logger.error("order confirmation mail failed", e, { orderId: p.orderId }),
    );
    void sendAdminAlert(p.orderId).catch((e) =>
      logger.error("admin alert mail failed", e, { orderId: p.orderId }),
    );
  } else if (outcome === "PAID_AFTER_CANCEL") {
    logger.error(
      "payment captured on non-CREATED order (webhook)",
      new Error("paid_after_cancel"),
      { orderId: p.orderId },
    );
    void sendPaidAfterCancelAlert(p.orderId).catch((e) =>
      logger.error("paid-after-cancel alert mail failed", e, { orderId: p.orderId }),
    );
  }
}

export async function handlePaymentFailed(payment: WebhookPaymentEntity): Promise<void> {
  if (!payment.order_id) return;
  const p = await prisma.payment.findFirst({
    where: { providerOrderId: payment.order_id },
    select: { id: true, status: true },
  });
  if (!p || p.status === "CAPTURED") return;
  await prisma.payment.update({
    where: { id: p.id },
    data: {
      status: "FAILED",
      providerPaymentId: payment.id ?? null,
      errorCode: payment.error_code ?? null,
      errorDescription: payment.error_description ?? null,
    },
  });
}

export async function handleRefundProcessed(refund: WebhookRefundEntity): Promise<void> {
  if (!refund.id) return;
  const r = await prisma.refund.findUnique({
    where: { providerRefundId: refund.id },
    select: { id: true, status: true, orderId: true, kind: true },
  });
  if (!r || r.status === "PROCESSED") return;
  const { maybeFlipOrderToTerminalState } = await import("./adminRefundClaimsService.js");
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: r.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    // Reconcile for BOTH kinds: a PRE_SHIP_CANCEL refund (= full totalPrice)
    // flips the order to REFUNDED + payment REFUNDED once settled; a DAMAGE_CLAIM
    // partial leaves the order in the right state. Previously pre-ship cancels
    // settling async via webhook left payment stuck CAPTURED.
    await maybeFlipOrderToTerminalState(tx, r.orderId, null);
  });
}

// ─── reaper ──────────────────────────────────────────────────────────────

/**
 * Cancels CREATED orders that have aged past ORDER_CREATED_TTL_MIN, restoring
 * stock atomically. Safe to invoke repeatedly — each pass only touches orders
 * still in CREATED state.
 */
export async function reapStaleCreatedOrders(): Promise<number> {
  const cutoff = new Date(Date.now() - env.ORDER_CREATED_TTL_MIN * 60_000);
  const stale = await prisma.order.findMany({
    where: { status: "CREATED", createdAt: { lt: cutoff } },
    select: { id: true, items: { select: { variantId: true, qty: true } } },
  });
  if (stale.length === 0) return 0;

  let cancelled = 0;
  for (const o of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        // Restore stock + audit. Skip items whose variant was hard-deleted.
        for (const item of o.items) {
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
              reason: "payment_timeout",
              refOrderId: o.id,
            },
          });
        }
        // Release any promotions this never-paid order held (all uncommitted).
        await tx.promotionRedemption.deleteMany({ where: { orderId: o.id } });
        await tx.order.update({
          where: { id: o.id, status: "CREATED" },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        await tx.orderStatusEvent.create({
          data: { orderId: o.id, status: "CANCELLED", note: "payment_timeout" },
        });
      });
      cancelled += 1;
    } catch (err) {
      logger.error("reaper failed for order", err as Error, { orderId: o.id });
    }
  }
  return cancelled;
}
