/**
 * Wire types for the promotion engine (/api/promotions, checkout, admin).
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { I18nString } from "./products.js";

export type PromotionRewardType = "PERCENT" | "FLAT" | "FREE_SHIPPING" | "BUY_X_GET_Y";
export type PromotionApplyMode = "AUTOMATIC" | "CODE";

/** A giftable variant in a BUY_X_GET_Y pool — user picks from these only. */
export interface GiftOptionDto {
  variantId: string;
  productId: string;
  slug: string;
  name: I18nString;
  image: string | null;
  sizeMl: number;
  /** paise — full price; becomes free when chosen */
  price: number;
  inStock: boolean;
}

/** BUY_X_GET_Y offer surfaced on the quote so the UI can show the gift popup. */
export interface BxGyOfferDto {
  promotionId: string;
  name: string;
  buyQty: number;
  getQty: number;
  /** true once cart qualifying qty >= buyQty */
  unlocked: boolean;
  /** variantIds currently chosen (subset of options, length <= getQty) */
  selected: string[];
  options: GiftOptionDto[];
}

/** A promotion that successfully applied to the quote/order. */
export interface AppliedPromotionDto {
  promotionId: string;
  code: string | null;
  name: string;
  rewardType: PromotionRewardType;
  /** paise saved by this promo (for FREE_SHIPPING = shipping waived amount) */
  amountPrice: number;
}

export type RejectedCodeReason =
  | "INVALID"
  | "EXPIRED"
  | "LIMIT_REACHED"
  | "MIN_ORDER"
  | "NOT_ELIGIBLE";

export interface RejectedCodeDto {
  code: string;
  reason: RejectedCodeReason;
}

/** Public seasonal banner payload (GET /api/promotions/banner). */
export interface BannerPromotionDto {
  id: string;
  bannerText: I18nString;
  /** ISO — drives the DD:HH:MM countdown; null = no end */
  expiresAt: string | null;
}

export interface BannerResponse {
  banners: BannerPromotionDto[];
}
