import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  AdminInventoryAdjustRequest,
  AdminInventoryAdjustResponse,
  AdminInventoryItemDto,
  AdminInventoryListQuery,
  AdminInventoryListResponse,
} from "../types/admin.js";
import type { I18nString } from "../types/products.js";

const LOW_STOCK_THRESHOLD = 5;

function jsonToI18n(v: Prisma.JsonValue | null | undefined): I18nString {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return {
      en: typeof o.en === "string" ? o.en : "",
      ar: typeof o.ar === "string" ? o.ar : "",
    };
  }
  return { en: "", ar: "" };
}

export async function list(query: AdminInventoryListQuery): Promise<AdminInventoryListResponse> {
  const page = query.page ?? 1;
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const skip = (page - 1) * pageSize;

  const and: Prisma.ProductVariantWhereInput[] = [{ deletedAt: null }];
  if (query.lowStockOnly) and.push({ stock: { lte: LOW_STOCK_THRESHOLD } });
  if (query.q && query.q.trim().length > 0) {
    const q = query.q.trim();
    and.push({
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { slug: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.ProductVariantWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: [{ stock: "asc" }, { sku: "asc" }],
      skip,
      take: pageSize,
      include: { product: { select: { id: true, name: true } } },
    }),
    prisma.productVariant.count({ where }),
  ]);

  const items: AdminInventoryItemDto[] = rows.map((v) => ({
    variantId: v.id,
    productId: v.productId,
    productName: jsonToI18n(v.product.name),
    sku: v.sku,
    sizeMl: v.sizeMl,
    stock: v.stock,
    isActive: v.isActive,
    deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
  }));

  return { items, page, pageSize, total };
}

export async function adjust(
  variantId: string,
  userId: string,
  input: AdminInventoryAdjustRequest,
): Promise<AdminInventoryAdjustResponse> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "delta must be a non-zero integer");
  }

  return prisma.$transaction(async (tx) => {
    const v = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, stock: true },
    });
    if (!v) throw new HttpError(404, "NOT_FOUND", "Variant not found");
    const newStock = v.stock + input.delta;
    if (newStock < 0) {
      throw new HttpError(400, "VALIDATION_ERROR", "Resulting stock cannot be negative");
    }
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: newStock },
    });
    const adj = await tx.inventoryAdjustment.create({
      data: {
        variantId,
        delta: input.delta,
        newStock,
        reason: input.reason,
        performedByUserId: userId,
      },
    });
    return {
      variantId,
      delta: input.delta,
      newStock,
      reason: adj.reason,
      createdAt: adj.createdAt.toISOString(),
    };
  });
}
