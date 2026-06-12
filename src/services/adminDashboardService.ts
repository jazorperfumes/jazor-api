import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type {
  AdminDashboardDto,
  AdminLowStockVariantDto,
  AdminPendingShipmentDto,
} from "../types/admin.js";
import type { I18nString } from "../types/products.js";
import type { OrderStatus } from "../types/orders.js";

const LOW_STOCK_THRESHOLD = 5;
const LOW_STOCK_LIMIT = 20;
const PENDING_SHIPMENT_LIMIT = 20;

const REVENUE_STATUSES: OrderStatus[] = ["PAID", "PACKED", "SHIPPED", "DELIVERED"];

function jsonToI18n(value: Prisma.JsonValue | null | undefined): I18nString {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return {
      en: typeof v.en === "string" ? v.en : "",
      ar: typeof v.ar === "string" ? v.ar : "",
    };
  }
  return { en: "", ar: "" };
}

function startOfTodayUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function sumRevenue(since: Date): Promise<number> {
  const agg = await prisma.order.aggregate({
    where: {
      status: { in: REVENUE_STATUSES },
      paidAt: { gte: since },
    },
    _sum: { totalPrice: true },
  });
  return agg._sum.totalPrice ?? 0;
}

export async function dashboard(): Promise<AdminDashboardDto> {
  const now = new Date();
  const today = startOfTodayUtc();
  const week = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const month = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);

  const [revToday, revWeek, revMonth, statusGroups, customerCount, productCount, lowStockRows, pendingShipmentRows] =
    await Promise.all([
      sumRevenue(today),
      sumRevenue(week),
      sumRevenue(month),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.user.count({ where: { role: "CUSTOMER" } }),
      prisma.product.count({ where: { deletedAt: null } }),
      prisma.productVariant.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          stock: { lte: LOW_STOCK_THRESHOLD },
        },
        orderBy: { stock: "asc" },
        take: LOW_STOCK_LIMIT,
        include: { product: { select: { id: true, name: true } } },
      }),
      prisma.order.findMany({
        where: {
          status: "PAID",
          shipments: { none: {} },
        },
        orderBy: { paidAt: "asc" },
        take: PENDING_SHIPMENT_LIMIT,
        select: {
          id: true,
          orderNumber: true,
          placedAt: true,
          paidAt: true,
          totalPrice: true,
          _count: { select: { items: true } },
        },
      }),
    ]);

  const orderCounts: Record<OrderStatus, number> = {
    CREATED: 0,
    PAID: 0,
    PACKED: 0,
    SHIPPED: 0,
    DELIVERED: 0,
    REFUND_PROCESSING: 0,
    CANCELLED: 0,
    REFUNDED: 0,
  };
  for (const g of statusGroups) {
    orderCounts[g.status as OrderStatus] = g._count._all;
  }

  const lowStockVariants: AdminLowStockVariantDto[] = lowStockRows.map((v) => ({
    variantId: v.id,
    productId: v.productId,
    sku: v.sku,
    sizeMl: v.sizeMl,
    stock: v.stock,
    name: jsonToI18n(v.product.name),
  }));

  const pendingShipments: AdminPendingShipmentDto[] = pendingShipmentRows.map((o) => ({
    orderId: o.id,
    orderNumber: o.orderNumber,
    placedAt: o.placedAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    totalPrice: o.totalPrice,
    itemCount: o._count.items,
  }));

  void now;

  return {
    revenue: { today: revToday, week: revWeek, month: revMonth },
    orderCounts,
    customerCount,
    productCount,
    lowStockVariants,
    pendingShipments,
  };
}
