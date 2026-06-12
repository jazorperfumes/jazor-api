import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type { I18nString } from "../types/products.js";
import type {
  AdminGiftVariantOptionsResponse,
  AdminPromotionDto,
  AdminPromotionListResponse,
  AdminPromotionPatchRequest,
  AdminPromotionStatus,
  AdminPromotionStatusFilter,
  AdminPromotionUpsertRequest,
} from "../types/admin.js";

type PromotionRow = Prisma.PromotionGetPayload<{
  include: {
    giftProducts: {
      include: { variant: { include: { product: { select: { name: true } } } } };
    };
  };
}>;

const include = {
  giftProducts: {
    include: { variant: { include: { product: { select: { name: true } } } } },
  },
} satisfies Prisma.PromotionInclude;

function jsonToI18n(value: Prisma.JsonValue | null): I18nString | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return { en: typeof v.en === "string" ? v.en : "", ar: typeof v.ar === "string" ? v.ar : "" };
  }
  return null;
}

/** Derive the lifecycle badge from raw fields + the current instant. Priority:
 * a manually-deactivated promo is INACTIVE regardless of dates; a future
 * startsAt is SCHEDULED; a past expiresAt is EXPIRED; a maxUses cap reached is
 * EXHAUSTED; otherwise it is live = ACTIVE. */
function computeStatus(p: PromotionRow, now: Date): AdminPromotionStatus {
  if (!p.isActive) return "INACTIVE";
  if (p.startsAt && p.startsAt > now) return "SCHEDULED";
  if (p.expiresAt && p.expiresAt < now) return "EXPIRED";
  if (p.maxUses > 0 && p.usedCount >= p.maxUses) return "EXHAUSTED";
  return "ACTIVE";
}

function toDto(p: PromotionRow, now: Date = new Date()): AdminPromotionDto {
  return {
    id: p.id,
    name: p.name,
    status: computeStatus(p, now),
    rewardType: p.rewardType,
    applyMode: p.applyMode,
    code: p.code,
    value: p.value,
    buyQty: p.buyQty,
    getQty: p.getQty,
    minOrderPrice: p.minOrderPrice,
    maxUses: p.maxUses,
    perUserLimit: p.perUserLimit,
    usedCount: p.usedCount,
    stackable: p.stackable,
    priority: p.priority,
    showBanner: p.showBanner,
    bannerText: jsonToI18n(p.bannerText),
    startsAt: p.startsAt ? p.startsAt.toISOString() : null,
    expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    isActive: p.isActive,
    giftProducts: p.giftProducts.map((g) => ({
      variantId: g.variantId,
      sku: g.variant.sku,
      sizeMl: g.variant.sizeMl,
      price: g.variant.price,
      productName: (jsonToI18n(g.variant.product.name) ?? { en: "", ar: "" }) as I18nString,
    })),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// ─── validation ──────────────────────────────────────────────────────────

function validateRewardShape(input: AdminPromotionUpsertRequest): void {
  const value = input.value ?? 0;
  switch (input.rewardType) {
    case "PERCENT":
      if (value < 1 || value > 100) throw new HttpError(400, "VALIDATION_ERROR", "Percent must be 1..100");
      break;
    case "FLAT":
      if (value <= 0) throw new HttpError(400, "VALIDATION_ERROR", "Flat value must be positive");
      break;
    case "FREE_SHIPPING":
      if ((input.minOrderPrice ?? 0) <= 0)
        throw new HttpError(400, "VALIDATION_ERROR", "Free shipping needs a minimum cart value");
      break;
    case "BUY_X_GET_Y":
      if ((input.buyQty ?? 0) <= 0 || (input.getQty ?? 0) <= 0)
        throw new HttpError(400, "VALIDATION_ERROR", "BxGy needs buyQty and getQty > 0");
      if (!input.giftVariantIds || input.giftVariantIds.length === 0)
        throw new HttpError(400, "VALIDATION_ERROR", "BxGy needs at least one gift product");
      break;
  }
  if (input.applyMode === "CODE" && !input.code?.trim()) {
    throw new HttpError(400, "VALIDATION_ERROR", "Code-mode promotion needs a code");
  }
}

async function assertGiftVariants(variantIds: string[]): Promise<void> {
  if (variantIds.length === 0) return;
  const count = await prisma.productVariant.count({ where: { id: { in: variantIds } } });
  if (count !== new Set(variantIds).size) {
    throw new HttpError(400, "PROMOTION_GIFT_INVALID", "One or more gift variants do not exist");
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

/** Translate a status filter bucket into a Prisma where clause, evaluated
 * against `now`. EXHAUSTED is intentionally not a bucket — those promos stay in
 * the "active" bucket (still live) and surface via the badge only. */
function statusWhere(
  status: AdminPromotionStatusFilter,
  now: Date,
): Prisma.PromotionWhereInput {
  switch (status) {
    case "active":
      return {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      };
    case "scheduled":
      return { isActive: true, startsAt: { gt: now } };
    case "expired":
      return { isActive: true, expiresAt: { lt: now } };
    case "inactive":
      return { isActive: false };
    case "all":
      return {};
  }
}

export async function list(
  query: { page?: number; pageSize?: number; status?: AdminPromotionStatusFilter } = {},
): Promise<AdminPromotionListResponse> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const now = new Date();
  const where = statusWhere(query.status ?? "active", now);
  const [rows, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.promotion.count({ where }),
  ]);
  return { items: rows.map((r) => toDto(r, now)), page, pageSize, total };
}

/**
 * Flat variant list powering the BxGy gift-pool picker. Lists every live
 * (non-deleted, active) variant of a live product. Out-of-stock variants are
 * included but flagged `inStock: false` — admin may pre-stage a promo before a
 * restock, and the checkout engine blocks OOS gifts at selection time.
 */
export async function giftVariantOptions(): Promise<AdminGiftVariantOptionsResponse> {
  const rows = await prisma.productVariant.findMany({
    where: { deletedAt: null, isActive: true, product: { deletedAt: null, isActive: true } },
    include: { product: { select: { name: true } } },
    orderBy: { sizeMl: "asc" },
  });
  // name is a Json column → Prisma can't orderBy it; sort by English name in JS.
  const items = rows.map((v) => ({
    variantId: v.id,
    productId: v.productId,
    productName: (jsonToI18n(v.product.name) ?? { en: "", ar: "" }) as I18nString,
    sku: v.sku,
    sizeMl: v.sizeMl,
    price: v.price,
    stock: v.stock,
    inStock: v.stock > 0,
  }));
  items.sort((a, b) => a.productName.en.localeCompare(b.productName.en) || a.sizeMl - b.sizeMl);
  return { items };
}

export async function create(input: AdminPromotionUpsertRequest): Promise<AdminPromotionDto> {
  validateRewardShape(input);
  const code = input.applyMode === "CODE" ? input.code!.trim().toUpperCase() : null;
  if (code) {
    const existing = await prisma.promotion.findUnique({ where: { code }, select: { id: true } });
    if (existing) throw new HttpError(409, "PROMOTION_CODE_TAKEN", "Code already in use");
  }
  const giftIds = input.rewardType === "BUY_X_GET_Y" ? input.giftVariantIds ?? [] : [];
  await assertGiftVariants(giftIds);

  const showBanner = input.showBanner ?? false;
  const p = await prisma.$transaction(async (tx) => {
    // Only one promotion may own the site-wide banner at a time.
    if (showBanner) {
      await tx.promotion.updateMany({
        where: { showBanner: true },
        data: { showBanner: false },
      });
    }
    return tx.promotion.create({
      data: {
        name: input.name.trim(),
        rewardType: input.rewardType,
        applyMode: input.applyMode,
        code,
        value: input.value ?? 0,
        buyQty: input.buyQty ?? 0,
        getQty: input.getQty ?? 0,
        minOrderPrice: input.minOrderPrice ?? 0,
        maxUses: input.maxUses ?? 0,
        perUserLimit: input.perUserLimit ?? 0,
        stackable: input.stackable ?? true,
        priority: input.priority ?? 100,
        showBanner,
        bannerText: input.bannerText
          ? (input.bannerText as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        isActive: input.isActive ?? true,
        giftProducts: { create: giftIds.map((variantId) => ({ variantId })) },
      },
      include,
    });
  });
  return toDto(p);
}

export async function patch(
  id: string,
  input: AdminPromotionPatchRequest,
): Promise<AdminPromotionDto> {
  const existing = await prisma.promotion.findUnique({
    where: { id },
    include: { giftProducts: { select: { variantId: true } } },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Promotion not found");

  // Validate the post-patch shape (merge input over existing) so a patch can't
  // leave the promotion in an invalid state (e.g. percent > 100, blank code).
  validateRewardShape({
    name: input.name ?? existing.name,
    rewardType: input.rewardType ?? existing.rewardType,
    applyMode: input.applyMode ?? existing.applyMode,
    code: input.code !== undefined ? input.code : existing.code,
    value: input.value ?? existing.value,
    buyQty: input.buyQty ?? existing.buyQty,
    getQty: input.getQty ?? existing.getQty,
    minOrderPrice: input.minOrderPrice ?? existing.minOrderPrice,
    giftVariantIds:
      input.giftVariantIds !== undefined
        ? input.giftVariantIds
        : existing.giftProducts.map((g) => g.variantId),
  });

  const data: Prisma.PromotionUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.rewardType !== undefined) data.rewardType = input.rewardType;
  if (input.applyMode !== undefined) data.applyMode = input.applyMode;
  if (input.code !== undefined) {
    const next = input.code ? input.code.trim().toUpperCase() : null;
    if (next !== existing.code) {
      if (next) {
        const dup = await prisma.promotion.findUnique({ where: { code: next }, select: { id: true } });
        if (dup) throw new HttpError(409, "PROMOTION_CODE_TAKEN", "Code already in use");
      }
      data.code = next;
    }
  }
  if (input.value !== undefined) data.value = input.value;
  if (input.buyQty !== undefined) data.buyQty = input.buyQty;
  if (input.getQty !== undefined) data.getQty = input.getQty;
  if (input.minOrderPrice !== undefined) data.minOrderPrice = input.minOrderPrice;
  if (input.maxUses !== undefined) data.maxUses = input.maxUses;
  if (input.perUserLimit !== undefined) data.perUserLimit = input.perUserLimit;
  if (input.stackable !== undefined) data.stackable = input.stackable;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.showBanner !== undefined) data.showBanner = input.showBanner;
  if (input.bannerText !== undefined)
    data.bannerText = input.bannerText
      ? (input.bannerText as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  // Gift pool replacement (only when explicitly provided).
  const replaceGifts = input.giftVariantIds !== undefined;
  if (replaceGifts) {
    await assertGiftVariants(input.giftVariantIds!);
  }

  const p = await prisma.$transaction(async (tx) => {
    // Only one promotion may own the site-wide banner — unset the others.
    if (input.showBanner === true) {
      await tx.promotion.updateMany({
        where: { showBanner: true, NOT: { id } },
        data: { showBanner: false },
      });
    }
    if (replaceGifts) {
      await tx.promotionGiftProduct.deleteMany({ where: { promotionId: id } });
      if (input.giftVariantIds!.length > 0) {
        await tx.promotionGiftProduct.createMany({
          data: input.giftVariantIds!.map((variantId) => ({ promotionId: id, variantId })),
        });
      }
    }
    return tx.promotion.update({ where: { id }, data, include });
  });
  return toDto(p);
}

export async function deactivate(id: string): Promise<AdminPromotionDto> {
  const existing = await prisma.promotion.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Promotion not found");
  const p = await prisma.promotion.update({ where: { id }, data: { isActive: false }, include });
  return toDto(p);
}
