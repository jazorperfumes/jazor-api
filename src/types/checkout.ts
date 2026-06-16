/**
 * Wire types for /api/checkout endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { I18nString } from "./products.js";
import type {
  AppliedPromotionDto,
  BxGyOfferDto,
  RejectedCodeDto,
} from "./promotion.js";

/** Soft-fail signals on quote — never thrown, only annotated on the response. */
export type QuoteIssue =
  | "CART_EMPTY"
  | "OUT_OF_STOCK"
  | "BXGY_GIFT_REQUIRED"
  | "NOT_SERVICEABLE";

export interface GiftSelection {
  promotionId: string;
  variantId: string;
}

export interface QuoteItemDto {
  variantId: string;
  name: I18nString;
  slug: string | null;
  image: string | null;
  sizeMl: number;
  /** paise */
  unitPrice: number;
  qty: number;
  /** paise */
  lineTotal: number;
  inStock: boolean;
  availableStock: number;
  /** true = free gift line from a BUY_X_GET_Y promo (offset in discountPrice) */
  isGift?: boolean;
}

export interface QuoteRequest {
  /** manual coupon codes to apply (CODE-mode promotions) */
  discountCodes?: string[];
  /** chosen free gifts for unlocked BUY_X_GET_Y promotions */
  giftSelections?: GiftSelection[];
  giftWrap?: boolean;
  pincode?: string;
}

export interface QuoteResponse {
  items: QuoteItemDto[];
  /** paise */
  subtotalPrice: number;
  discountPrice: number;
  shippingPrice: number;
  giftWrapPrice: number;
  totalPrice: number;
  appliedPromotions: AppliedPromotionDto[];
  bxgyOffers: BxGyOfferDto[];
  rejectedCodes: RejectedCodeDto[];
  issues: QuoteIssue[];
  /** false = delivery pincode not serviceable by any courier (blocks placement) */
  serviceable: boolean;
  /** fastest serviceable-courier ETA in days; null in manual mode / no pincode */
  estimatedDeliveryDays: number | null;
  /** post-discount subtotal needed for free shipping; 0 = threshold disabled */
  freeShippingThresholdPaise: number;
}
