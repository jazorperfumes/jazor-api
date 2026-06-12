import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  AdminCustomerDetailDto,
  AdminCustomerListItemDto,
  AdminCustomerListQuery,
  AdminCustomerListResponse,
  AdminCustomerOrderDto,
} from "../types/admin.js";
import type { OrderStatus } from "../types/orders.js";

const LTV_STATUSES: OrderStatus[] = ["PAID", "PACKED", "SHIPPED", "DELIVERED"];

export async function list(query: AdminCustomerListQuery): Promise<AdminCustomerListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
  const skip = (page - 1) * pageSize;

  const where: Prisma.UserWhereInput = {};
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    where.OR = [
      { email: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  const ids = rows.map((u) => u.id);
  const orderStats = ids.length
    ? await prisma.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const ltvStats = ids.length
    ? await prisma.order.groupBy({
        by: ["userId"],
        where: { userId: { in: ids }, status: { in: LTV_STATUSES } },
        _sum: { totalPrice: true },
      })
    : [];

  const countById = new Map(orderStats.map((g) => [g.userId, g._count._all]));
  const ltvById = new Map(ltvStats.map((g) => [g.userId, g._sum.totalPrice ?? 0]));

  const items: AdminCustomerListItemDto[] = rows.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    orderCount: countById.get(u.id) ?? 0,
    lifetimeValue: ltvById.get(u.id) ?? 0,
    createdAt: u.createdAt.toISOString(),
  }));

  return { items, page, pageSize, total };
}

export async function detail(id: string): Promise<AdminCustomerDetailDto> {
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new HttpError(404, "NOT_FOUND", "Customer not found");

  const [orderStats, ltvStats, orders] = await Promise.all([
    prisma.order.count({ where: { userId: id } }),
    prisma.order.aggregate({
      where: { userId: id, status: { in: LTV_STATUSES } },
      _sum: { totalPrice: true },
    }),
    prisma.order.findMany({
      where: { userId: id },
      orderBy: { placedAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        placedAt: true,
        totalPrice: true,
      },
    }),
  ]);

  const orderDtos: AdminCustomerOrderDto[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    totalPrice: o.totalPrice,
  }));

  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    orderCount: orderStats,
    lifetimeValue: ltvStats._sum.totalPrice ?? 0,
    createdAt: u.createdAt.toISOString(),
    orders: orderDtos,
  };
}
