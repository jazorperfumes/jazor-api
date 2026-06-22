/**
 * Wire types for /api/products endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

export type Collection = "FRENCH" | "ARABIC";

/** Cross-cutting overlay on top of Collection. null = standard product. */
export type Tier = "SIGNATURE" | "DARK";

export type Intensity = "LIGHT" | "MODERATE" | "STRONG" | "IMPACTFUL";

export type Family =
  | "FLORAL"
  | "WOODY"
  | "ORIENTAL"
  | "FRESH"
  | "OUD"
  | "AMBER"
  | "CITRUS"
  | "AQUATIC"
  | "GOURMAND";

export type ProductSort = "newest" | "priceAsc" | "priceDesc" | "featured";

export interface ProductListQuery {
  collection?: Collection;
  tier?: Tier;
  family?: Family;
  q?: string;
  minPrice?: number; // paise
  maxPrice?: number; // paise
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
}

/** i18n shape used by Product.name/description and notes lists. */
export interface I18nString {
  en: string;
  ar: string;
}

export interface VariantSummaryDto {
  id: string;
  sku: string;
  sizeMl: number;
  /** paise */
  price: number;
  /** server-clamped: true if stock > 0 */
  inStock: boolean;
}

export interface ProductImageSummaryDto {
  id: string;
  /** owning variant — images are per-variant (50ml vs 100ml differ) */
  variantId: string;
  url: string;
  alt: I18nString | null;
}

export interface ProductListItemDto {
  id: string;
  slug: string;
  name: I18nString;
  collection: Collection;
  tier: Tier | null;
  family: Family;
  intensity: Intensity | null;
  longevity: number;
  sillage: number;
  isFeatured: boolean;
  primaryImage: ProductImageSummaryDto | null;
  variants: VariantSummaryDto[];
  /** paise — cheapest active variant. Convenience for list cards. */
  minPrice: number | null;
}

export interface ProductListResponse {
  items: ProductListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

// ─── detail ────────────────────────────────────────────────────────────────

export type Mood = "CONFIDENT" | "CALM" | "MYSTERIOUS" | "FRESH";
export type Occasion = "DAY" | "EVENING" | "SPECIAL" | "DAILY";

export interface I18nList {
  en: string[];
  ar: string[];
}

export interface ProductDetailVariantDto extends VariantSummaryDto {
  stock: number;
}

export interface ProductDetailDto {
  id: string;
  slug: string;
  name: I18nString;
  description: I18nString;
  collection: Collection;
  tier: Tier | null;
  family: Family;
  intensity: Intensity | null;
  longevity: number;
  sillage: number;
  isFeatured: boolean;
  moods: Mood[];
  occasions: Occasion[];
  notes: {
    top: I18nList;
    heart: I18nList;
    base: I18nList;
  };
  images: ProductImageSummaryDto[];
  variants: ProductDetailVariantDto[];
  /** paise — cheapest active variant */
  minPrice: number | null;
  reviewSummary: {
    avgRating: number; // 0..5, two-decimal
    reviewCount: number;
  };
  createdAt: string; // ISO
}

// ─── reviews ───────────────────────────────────────────────────────────────

export type ReviewListSort = "newest" | "highRated" | "lowRated";

export interface ReviewDto {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
  adminReply: string | null;
  adminReplyAt: string | null;
}

export interface ReviewListResponse {
  items: ReviewDto[];
  page: number;
  pageSize: number;
  total: number;
  avgRating: number;
}

// ─── related ───────────────────────────────────────────────────────────────

export interface RelatedProductsResponse {
  items: ProductListItemDto[];
}
