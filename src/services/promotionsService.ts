import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";
import type { I18nString } from "../types/products.js";
import type {
  AppliedPromotionDto,
  BannerPromotionDto,
  BxGyOfferDto,
  GiftOptionDto,
  PromotionRewardType,
  RejectedCodeDto,
  RejectedCodeReason,
} from "../types/promotion.js";
import { firstImageOf } from "./productImage.js";

// ─── helpers ─────────────────────────────────────────────────────────────

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

function inWindow(p: { startsAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  if (p.startsAt && p.startsAt > now) return false;
  if (p.expiresAt && p.expiresAt <= now) return false;
  return true;
}

// ─── engine I/O ────────────────────────────────────────────────────────────

export interface EngineCartItem {
  variantId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface EngineInput {
  userId: string;
  items: EngineCartItem[];
  /** cart-only subtotal in paise (excludes gifts) */
  subtotalPrice: number;
  discountCodes: string[];
  giftSelections: { promotionId: string; variantId: string }[];
}

export interface EngineGiftLine {
  variantId: string;
  name: I18nString;
  slug: string;
  image: string | null;
  sizeMl: number;
  sku: string;
  collection: string;
  family: string;
  unitPrice: number;
  inStock: boolean;
  availableStock: number;
}

/** One promo to persist as a PromotionRedemption row at order create. */
export interface ResolvedPromotion {
  promotionId: string;
  code: string | null;
  name: string;
  rewardType: PromotionRewardType;
  amountPrice: number;
  giftVariantId: string | null;
}

export interface EngineResult {
  appliedPromotions: AppliedPromotionDto[];
  bxgyOffers: BxGyOfferDto[];
  rejectedCodes: RejectedCodeDto[];
  /** free gift lines to append to the displayed items (full price) */
  giftLines: EngineGiftLine[];
  /** sum of gift prices — added to BOTH subtotal and discount so it nets to free */
  giftValue: number;
  /** percent + flat discount on cart subtotal (capped to subtotal) */
  monetaryDiscount: number;
  /** final shipping after any FREE_SHIPPING promo */
  shippingPrice: number;
  /** an unlocked BxGy offer has no/incomplete gift selection */
  bxgyGiftRequired: boolean;
  resolved: ResolvedPromotion[];
}

type PromotionRow = Prisma.PromotionGetPayload<{ include: { giftProducts: true } }>;

interface GiftVariantData {
  variantId: string;
  productId: string;
  slug: string;
  name: I18nString;
  image: string | null;
  sizeMl: number;
  sku: string;
  collection: string;
  family: string;
  price: number;
  stock: number;
  inStock: boolean;
}

// ─── candidate gathering ─────────────────────────────────────────────────

async function loadCandidates(
  codes: string[],
  now: Date,
): Promise<{ automatic: PromotionRow[]; coded: Map<string, PromotionRow | null> }> {
  const automatic = await prisma.promotion.findMany({
    where: { applyMode: "AUTOMATIC", isActive: true },
    include: { giftProducts: true },
    orderBy: { priority: "asc" },
  });

  const coded = new Map<string, PromotionRow | null>();
  const normalized = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (normalized.length > 0) {
    const rows = await prisma.promotion.findMany({
      where: { applyMode: "CODE", code: { in: normalized } },
      include: { giftProducts: true },
    });
    const byCode = new Map(rows.map((r) => [r.code as string, r]));
    for (const code of normalized) coded.set(code, byCode.get(code) ?? null);
  }

  return {
    automatic: automatic.filter((p) => inWindow(p, now)),
    coded,
  };
}

async function loadGiftVariants(variantIds: string[]): Promise<Map<string, GiftVariantData>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { images: true, product: true },
  });
  const map = new Map<string, GiftVariantData>();
  for (const v of rows) {
    const primary = firstImageOf(v.images);
    const inStock =
      v.isActive && v.deletedAt == null && v.product.isActive && v.product.deletedAt == null && v.stock > 0;
    map.set(v.id, {
      variantId: v.id,
      productId: v.productId,
      slug: v.product.slug,
      name: jsonToI18n(v.product.name),
      image: primary?.url ?? null,
      sizeMl: v.sizeMl,
      sku: v.sku,
      collection: v.product.collection,
      family: v.product.family,
      price: v.price,
      stock: v.stock,
      inStock,
    });
  }
  return map;
}

// ─── eligibility ───────────────────────────────────────────────────────────

async function checkLimits(
  promo: PromotionRow,
  userId: string,
): Promise<RejectedCodeReason | null> {
  // Count live redemptions (committed OR in-flight on a non-cancelled order),
  // not just usedCount. This closes the bypass where a user creates several
  // unpaid CREATED orders with the same code before any of them captures.
  if (promo.maxUses > 0) {
    const total = await prisma.promotionRedemption.count({
      where: { promotionId: promo.id, order: { status: { not: "CANCELLED" } } },
    });
    if (total >= promo.maxUses) return "LIMIT_REACHED";
  }
  if (promo.perUserLimit > 0) {
    const used = await prisma.promotionRedemption.count({
      where: { promotionId: promo.id, userId, order: { status: { not: "CANCELLED" } } },
    });
    if (used >= promo.perUserLimit) return "LIMIT_REACHED";
  }
  return null;
}

function provisionalAmount(promo: PromotionRow, subtotal: number): number {
  if (promo.rewardType === "PERCENT") {
    return Math.floor((subtotal * Math.min(Math.max(promo.value, 0), 100)) / 100);
  }
  if (promo.rewardType === "FLAT") return Math.min(Math.max(promo.value, 0), subtotal);
  return 0;
}

// ─── main entry ──────────────────────────────────────────────────────────

export async function applyPromotions(input: EngineInput): Promise<EngineResult> {
  const now = new Date();
  const { userId, items, subtotalPrice } = input;
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const { automatic, coded } = await loadCandidates(input.discountCodes, now);

  const rejectedCodes: RejectedCodeDto[] = [];

  // Resolve code candidates → eligible promos or rejections.
  let codeEligible: PromotionRow[] = [];
  for (const [code, promo] of coded) {
    if (!promo || !promo.isActive) {
      rejectedCodes.push({ code, reason: "INVALID" });
      continue;
    }
    if (promo.startsAt && promo.startsAt > now) {
      rejectedCodes.push({ code, reason: "INVALID" });
      continue;
    }
    if (promo.expiresAt && promo.expiresAt <= now) {
      rejectedCodes.push({ code, reason: "EXPIRED" });
      continue;
    }
    const limit = await checkLimits(promo, userId);
    if (limit) {
      rejectedCodes.push({ code, reason: limit });
      continue;
    }
    if (promo.minOrderPrice > 0 && subtotalPrice < promo.minOrderPrice) {
      rejectedCodes.push({ code, reason: "MIN_ORDER" });
      continue;
    }
    codeEligible.push(promo);
  }

  // Automatic candidates: filter by limits + min order (silent skip, no rejection).
  let autoEligible: PromotionRow[] = [];
  for (const promo of automatic) {
    if (await checkLimits(promo, userId)) continue;
    // FREE_SHIPPING uses minOrderPrice as the threshold (handled in apply); others gate on it.
    if (promo.rewardType !== "FREE_SHIPPING" && promo.minOrderPrice > 0 && subtotalPrice < promo.minOrderPrice) {
      continue;
    }
    autoEligible.push(promo);
  }

  // ── Exclusivity gate (stackable = false wins alone, ANY reward type) ──
  // A non-stackable promo blocks every other promo for this order — monetary,
  // gift, and free-shipping alike, automatic or coded. If several non-stackable
  // promos qualify, the lowest-priority (then oldest) one wins. Dropped coded
  // promos surface as NOT_ELIGIBLE; dropped automatics are silent.
  const exclusives = [...autoEligible, ...codeEligible].filter((p) => !p.stackable);
  if (exclusives.length > 0) {
    const winner = [...exclusives].sort(
      (a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime(),
    )[0];
    for (const p of [...autoEligible, ...codeEligible]) {
      if (p.id !== winner.id && p.code) rejectedCodes.push({ code: p.code, reason: "NOT_ELIGIBLE" });
    }
    autoEligible = autoEligible.filter((p) => p.id === winner.id);
    codeEligible = codeEligible.filter((p) => p.id === winner.id);
  }

  // ── BxGy offers + gift selection resolution ──
  const bxgyOffers: BxGyOfferDto[] = [];
  const giftLines: EngineGiftLine[] = [];
  const bxgyResolved: ResolvedPromotion[] = [];
  let giftValue = 0;
  let bxgyGiftRequired = false;

  const bxgyPromos = [...autoEligible, ...codeEligible].filter((p) => p.rewardType === "BUY_X_GET_Y");
  if (bxgyPromos.length > 0) {
    const poolIds = [...new Set(bxgyPromos.flatMap((p) => p.giftProducts.map((g) => g.variantId)))];
    const giftData = await loadGiftVariants(poolIds);

    for (const promo of bxgyPromos) {
      const unlocked = totalQty >= promo.buyQty && promo.buyQty > 0;
      const options: GiftOptionDto[] = promo.giftProducts
        .map((g) => giftData.get(g.variantId))
        .filter((d): d is GiftVariantData => Boolean(d))
        .map((d) => ({
          variantId: d.variantId,
          productId: d.productId,
          slug: d.slug,
          name: d.name,
          image: d.image,
          sizeMl: d.sizeMl,
          price: d.price,
          inStock: d.inStock,
        }));

      const picks = input.giftSelections
        .filter((s) => s.promotionId === promo.id)
        .map((s) => s.variantId)
        .filter((vid) => promo.giftProducts.some((g) => g.variantId === vid))
        .slice(0, promo.getQty);

      bxgyOffers.push({
        promotionId: promo.id,
        name: promo.name,
        buyQty: promo.buyQty,
        getQty: promo.getQty,
        unlocked,
        selected: picks,
        options,
      });

      if (!unlocked) continue;
      const validPicks = picks.filter((vid) => giftData.get(vid)?.inStock);
      if (validPicks.length === 0) {
        bxgyGiftRequired = true;
        continue;
      }

      let promoGiftValue = 0;
      for (const vid of validPicks) {
        const d = giftData.get(vid)!;
        giftLines.push({
          variantId: d.variantId,
          name: d.name,
          slug: d.slug,
          image: d.image,
          sizeMl: d.sizeMl,
          sku: d.sku,
          collection: d.collection,
          family: d.family,
          unitPrice: d.price,
          inStock: d.inStock,
          availableStock: d.stock,
        });
        promoGiftValue += d.price;
      }
      giftValue += promoGiftValue;
      bxgyResolved.push({
        promotionId: promo.id,
        code: promo.code,
        name: promo.name,
        rewardType: "BUY_X_GET_Y",
        amountPrice: promoGiftValue,
        // one row per promo; first pick recorded for reference
        giftVariantId: validPicks[0],
      });
    }
  }

  // ── monetary promos (PERCENT / FLAT), applied in priority order with cap ──
  const monetaryPromos = [...autoEligible, ...codeEligible]
    .filter((p) => p.rewardType === "PERCENT" || p.rewardType === "FLAT")
    .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

  // Exclusivity already resolved by the gate above; if a non-stackable promo
  // won, monetaryPromos holds at most that one.
  const monetarySet = monetaryPromos;

  const monetaryResolved: ResolvedPromotion[] = [];
  let monetaryDiscount = 0;
  let remaining = subtotalPrice;
  for (const promo of monetarySet) {
    const raw = provisionalAmount(promo, subtotalPrice);
    const amt = Math.min(raw, remaining);
    if (amt <= 0) continue;
    remaining -= amt;
    monetaryDiscount += amt;
    monetaryResolved.push({
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      rewardType: promo.rewardType as PromotionRewardType,
      amountPrice: amt,
      giftVariantId: null,
    });
  }

  // ── shipping / FREE_SHIPPING ──
  // Shipping is only free via a FREE_SHIPPING promo — there is no always-on
  // env threshold. Every order pays flat shipping unless a promo waives it.
  const baseShipping = env.FLAT_SHIPPING_PAISE;

  const freeShipPromos = [...autoEligible, ...codeEligible]
    .filter((p) => p.rewardType === "FREE_SHIPPING" && subtotalPrice >= p.minOrderPrice)
    .sort((a, b) => a.priority - b.priority);

  let shippingPrice = baseShipping;
  const shipResolved: ResolvedPromotion[] = [];
  if (freeShipPromos.length > 0) {
    const promo = freeShipPromos[0];
    const waived = baseShipping;
    shippingPrice = 0;
    shipResolved.push({
      promotionId: promo.id,
      code: promo.code,
      name: promo.name,
      rewardType: "FREE_SHIPPING",
      amountPrice: waived,
      giftVariantId: null,
    });
  }

  const resolved = [...monetaryResolved, ...bxgyResolved, ...shipResolved];
  const appliedPromotions: AppliedPromotionDto[] = resolved.map((r) => ({
    promotionId: r.promotionId,
    code: r.code,
    name: r.name,
    rewardType: r.rewardType,
    amountPrice: r.amountPrice,
  }));

  return {
    appliedPromotions,
    bxgyOffers,
    rejectedCodes,
    giftLines,
    giftValue,
    monetaryDiscount,
    shippingPrice,
    bxgyGiftRequired,
    resolved,
  };
}

// ─── public banner ─────────────────────────────────────────────────────────

export async function activeBanners(): Promise<BannerPromotionDto[]> {
  const now = new Date();
  const rows = await prisma.promotion.findMany({
    where: {
      isActive: true,
      showBanner: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
    },
    orderBy: { priority: "asc" },
  });
  // Only one banner shows at a time; lowest priority wins. Slice after the
  // window filter so a top-priority but out-of-window promo can't shadow it.
  return rows
    .filter((p) => inWindow(p, now))
    .slice(0, 1)
    .map((p) => ({
      id: p.id,
      bannerText: jsonToI18n(p.bannerText),
      expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
    }));
}
