/**
 * Wire types for /api/admin/* endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type {
  Collection,
  Family,
  I18nList,
  I18nString,
  Intensity,
  Mood,
  Occasion,
  ProductImageSummaryDto,
  Tier,
} from "./products.js";
import type { OrderStatus, PaymentStatus, ShipmentStatus } from "./orders.js";
import type {
  AppliedPromotionDto,
  PromotionApplyMode,
  PromotionRewardType,
} from "./promotion.js";

// ─── dashboard ─────────────────────────────────────────────────────────────

export interface AdminRevenueBuckets {
  /** paise */
  today: number;
  week: number;
  month: number;
}

export interface AdminLowStockVariantDto {
  variantId: string;
  productId: string;
  sku: string;
  sizeMl: number;
  stock: number;
  name: I18nString;
}

export interface AdminPendingShipmentDto {
  orderId: string;
  orderNumber: string;
  placedAt: string;
  paidAt: string | null;
  totalPrice: number;
  itemCount: number;
}

export interface AdminDashboardDto {
  revenue: AdminRevenueBuckets;
  orderCounts: Record<OrderStatus, number>;
  customerCount: number;
  productCount: number;
  lowStockVariants: AdminLowStockVariantDto[];
  pendingShipments: AdminPendingShipmentDto[];
}

// ─── products ──────────────────────────────────────────────────────────────

export interface AdminProductListQuery {
  q?: string;
  collection?: Collection;
  tier?: Tier;
  family?: Family;
  isActive?: boolean;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminProductVariantDto {
  id: string;
  sku: string;
  sizeMl: number;
  /** paise */
  price: number;
  stock: number;
  weightGrams: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
  isActive: boolean;
  deletedAt: string | null;
}

export interface AdminProductListItemDto {
  id: string;
  slug: string;
  name: I18nString;
  collection: Collection;
  tier: Tier | null;
  family: Family;
  intensity: Intensity | null;
  isActive: boolean;
  isFeatured: boolean;
  deletedAt: string | null;
  variantCount: number;
  totalStock: number;
  /** paise */
  minPrice: number | null;
  primaryImage: ProductImageSummaryDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductListResponse {
  items: AdminProductListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminProductDetailDto {
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
  moods: Mood[];
  occasions: Occasion[];
  notes: { top: I18nList; heart: I18nList; base: I18nList };
  isActive: boolean;
  isFeatured: boolean;
  deletedAt: string | null;
  variants: AdminProductVariantDto[];
  images: ProductImageSummaryDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductUpsertRequest {
  slug?: string;
  name: I18nString;
  description: I18nString;
  collection: Collection;
  tier?: Tier | null;
  family: Family;
  intensity?: Intensity | null;
  longevity: number;
  sillage: number;
  topNotes: I18nList;
  heartNotes: I18nList;
  baseNotes: I18nList;
  moods: Mood[];
  occasions: Occasion[];
  isActive?: boolean;
  isFeatured?: boolean;
}

export type AdminProductPatchRequest = Partial<AdminProductUpsertRequest>;

// ─── product import (CSV) ────────────────────────────────────────────────────

export interface AdminProductImportRowError {
  /** 1-based row number in the data section (excludes header). */
  row: number;
  slug: string | null;
  messages: string[];
}

export interface AdminProductImportReport {
  /** data rows parsed (excludes header). */
  totalRows: number;
  /** rows that would be / were created. */
  created: number;
  /** valid rows skipped because the slug already exists. */
  skipped: number;
  /** rows that failed validation (never written). */
  errorCount: number;
  /** slugs that are new and pass validation (preview aid). */
  newSlugs: string[];
  /** slugs skipped as already-existing. */
  skippedSlugs: string[];
  errors: AdminProductImportRowError[];
  /** true = dry run (preview), no DB writes performed. */
  dryRun: boolean;
  /** per-row preview: echoed cells + status, for the editable import wizard. */
  rows: AdminProductImportPreviewRow[];
}

/** Raw CSV cell values keyed by IMPORT_COLUMNS (all strings). */
export type AdminProductImportCells = Record<string, string>;

export type AdminProductImportRowStatus = "new" | "skipped" | "error";

export interface AdminProductImportPreviewRow {
  /** 0-based position in the uploaded file. */
  index: number;
  cells: AdminProductImportCells;
  slug: string | null;
  status: AdminProductImportRowStatus;
  messages: string[];
}

export interface AdminProductImportValidateRowResponse {
  status: AdminProductImportRowStatus;
  slug: string | null;
  messages: string[];
}

export interface AdminProductImportApplyRowResponse {
  ok: boolean;
  status: AdminProductImportRowStatus;
  slug: string | null;
  /** id of the created product (present only when ok). */
  productId?: string;
  messages: string[];
}

// ─── variants ──────────────────────────────────────────────────────────────

export interface AdminVariantCreateRequest {
  sku: string;
  sizeMl: number;
  price: number; // paise
  stock?: number;
  weightGrams?: number;
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
  isActive?: boolean;
}

export interface AdminVariantPatchRequest {
  sku?: string;
  sizeMl?: number;
  price?: number;
  weightGrams?: number | null;
  lengthCm?: number | null;
  breadthCm?: number | null;
  heightCm?: number | null;
  isActive?: boolean;
}

// ─── inventory ─────────────────────────────────────────────────────────────

export interface AdminInventoryItemDto {
  variantId: string;
  productId: string;
  productName: I18nString;
  sku: string;
  sizeMl: number;
  stock: number;
  isActive: boolean;
  deletedAt: string | null;
}

export interface AdminInventoryListResponse {
  items: AdminInventoryItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminInventoryListQuery {
  q?: string;
  lowStockOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminInventoryAdjustRequest {
  delta: number; // can be negative
  reason: string; // e.g., "manual_edit", "restock"
  note?: string;
}

export interface AdminInventoryAdjustResponse {
  variantId: string;
  delta: number;
  newStock: number;
  reason: string;
  createdAt: string;
}

// ─── images ────────────────────────────────────────────────────────────────

export interface AdminImageUpdateRequest {
  position?: number;
  alt?: I18nString | null;
  /** reassign image to another variant of the same product */
  variantId?: string;
}

export interface AdminImageDto extends ProductImageSummaryDto {
  position: number;
}

// ─── orders ────────────────────────────────────────────────────────────────

export interface AdminOrderListQuery {
  q?: string; // matches orderNumber OR email
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  from?: string; // ISO date
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminOrderListItemDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus | null;
  email: string;
  customerName: string | null;
  placedAt: string;
  paidAt: string | null;
  totalPrice: number;
  itemCount: number;
}

export interface AdminOrderListResponse {
  items: AdminOrderListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminOrderStatusEventDto {
  id: string;
  status: OrderStatus;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}

export interface AdminOrderRefundDto {
  id: string;
  status: "REQUESTED" | "REJECTED" | "APPROVED" | "PENDING" | "PROCESSED" | "FAILED";
  kind: "PRE_SHIP_CANCEL" | "DAMAGE_CLAIM";
  reasonCode: "DAMAGED_BOTTLE" | null;
  amountPrice: number;
  reason: string | null;
  userDescription: string | null;
  reviewNote: string | null;
  providerRefundId: string | null;
  orderItemId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  processedAt: string | null;
}

export interface AdminOrderShipmentDto {
  id: string;
  status: ShipmentStatus;
  courier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  weightGrams: number | null;
  /** provider freight charged for this shipment, paise */
  shippingChargePrice: number | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface PackageDimensions {
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

export interface AdminOrderPaymentDto {
  id: string;
  status: PaymentStatus;
  method: string | null;
  amountPrice: number;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface AdminOrderCustomerDto {
  id: string | null;
  email: string;
  name: string | null;
  phone: string | null;
}

export interface AdminOrderDetailDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  subtotalPrice: number;
  discountPrice: number;
  shippingPrice: number;
  giftWrapPrice: number;
  totalPrice: number;
  /** auto-computed package for the ship/rate-shop form (editable) */
  suggestedPackage: PackageDimensions;
  /** order.shippingPrice − latest shipment freight; null until shipped */
  shippingMargin: number | null;
  promotions: AppliedPromotionDto[];
  giftWrap: boolean;
  giftMessage: string | null;
  notes: string | null;
  customer: AdminOrderCustomerDto;
  shippingAddress: {
    contactName: string;
    phone: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
    country: string;
  };
  items: Array<{
    id: string;
    variantId: string | null;
    name: I18nString;
    slug: string | null;
    image: string | null;
    sizeMl: number;
    sku: string;
    unitPrice: number;
    qty: number;
    lineTotalPrice: number;
  }>;
  payments: AdminOrderPaymentDto[];
  shipments: AdminOrderShipmentDto[];
  refunds: AdminOrderRefundDto[];
  events: AdminOrderStatusEventDto[];
}

export interface AdminOrderStatusRequest {
  status: OrderStatus;
  note?: string;
}

export interface AdminOrderShipRequest {
  courierName: string;
  awb: string;
  trackingUrl?: string;
  weightGrams?: number;
  lengthCm?: number;
  breadthCm?: number;
  heightCm?: number;
  pickupAddressId?: string;
}

// ─── shipping ─────────────────────────────────────────────────────────────

export interface AdminPickupAddressDto {
  id: string;
  label: string;
  contactName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  providerPickupId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPickupAddressUpsertRequest {
  label: string;
  contactName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  providerPickupId?: string | null;
  isDefault?: boolean;
}

export type AdminPickupAddressPatchRequest = Partial<AdminPickupAddressUpsertRequest>;

export interface AdminPickupAddressListQuery {
  page?: number;
  pageSize?: number;
}

export interface AdminPickupAddressListResponse {
  items: AdminPickupAddressDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminCourierOptionDto {
  courierId: number;
  courierName: string;
  /** paise */
  freightChargesPrice: number;
  /** paise */
  codChargesPrice: number;
  estimatedDeliveryDays: number | null;
  rating: number | null;
}

export interface AdminRateShopRequest {
  pickupAddressId: string;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

export interface AdminRateShopResponse {
  /** Live mode is off — UI should hide rate-shop and fall back to manual ship. */
  providerEnabled: boolean;
  options: AdminCourierOptionDto[];
}

export interface AdminShipLiveRequest {
  pickupAddressId: string;
  courierId: number;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

// ─── promotions ────────────────────────────────────────────────────────────

export interface AdminPromotionGiftDto {
  variantId: string;
  sku: string;
  sizeMl: number;
  /** paise */
  price: number;
  productName: I18nString;
}

/** Derived lifecycle state of a promotion (computed server-side from
 * isActive + start/expiry window + usage). Drives the table status badge. */
export type AdminPromotionStatus =
  | "ACTIVE"
  | "SCHEDULED"
  | "EXPIRED"
  | "EXHAUSTED"
  | "INACTIVE";

/** Filter buckets for the admin promotions list. "all" = no filter. */
export type AdminPromotionStatusFilter =
  | "active"
  | "scheduled"
  | "expired"
  | "inactive"
  | "all";

export interface AdminPromotionDto {
  id: string;
  name: string;
  status: AdminPromotionStatus;
  rewardType: PromotionRewardType;
  applyMode: PromotionApplyMode;
  code: string | null;
  value: number;
  buyQty: number;
  getQty: number;
  minOrderPrice: number;
  maxUses: number;
  perUserLimit: number;
  usedCount: number;
  stackable: boolean;
  priority: number;
  showBanner: boolean;
  bannerText: I18nString | null;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  giftProducts: AdminPromotionGiftDto[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminPromotionUpsertRequest {
  name: string;
  rewardType: PromotionRewardType;
  applyMode: PromotionApplyMode;
  code?: string | null;
  value?: number;
  buyQty?: number;
  getQty?: number;
  minOrderPrice?: number;
  maxUses?: number;
  perUserLimit?: number;
  stackable?: boolean;
  priority?: number;
  showBanner?: boolean;
  bannerText?: I18nString | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  isActive?: boolean;
  /** variantIds for the BUY_X_GET_Y gift pool (replaces existing on update) */
  giftVariantIds?: string[];
}

export type AdminPromotionPatchRequest = Partial<AdminPromotionUpsertRequest>;

export interface AdminPromotionListQuery {
  page?: number;
  pageSize?: number;
  status?: AdminPromotionStatusFilter;
}

export interface AdminPromotionListResponse {
  items: AdminPromotionDto[];
  page: number;
  pageSize: number;
  total: number;
}

/** A selectable variant for the BxGy gift-pool picker (admin form dropdown). */
export interface AdminGiftVariantOptionDto {
  variantId: string;
  productId: string;
  productName: I18nString;
  sku: string;
  sizeMl: number;
  /** paise */
  price: number;
  stock: number;
  inStock: boolean;
}

export interface AdminGiftVariantOptionsResponse {
  items: AdminGiftVariantOptionDto[];
}

// ─── customers ─────────────────────────────────────────────────────────────

export interface AdminCustomerListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminCustomerListItemDto {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: "CUSTOMER" | "ADMIN";
  emailVerifiedAt: string | null;
  orderCount: number;
  /** paise */
  lifetimeValue: number;
  createdAt: string;
}

export interface AdminCustomerListResponse {
  items: AdminCustomerListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminCustomerOrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  totalPrice: number;
}

export interface AdminCustomerDetailDto extends AdminCustomerListItemDto {
  orders: AdminCustomerOrderDto[];
}

// ─── reviews ───────────────────────────────────────────────────────────────

export interface AdminReviewListQuery {
  status?: "PENDING" | "APPROVED" | "REJECTED";
  productId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminReviewDto {
  id: string;
  productId: string;
  productName: I18nString;
  productSlug: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminReply: string | null;
  adminReplyAt: string | null;
  createdAt: string;
}

export interface AdminReviewListResponse {
  items: AdminReviewDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminReviewReplyRequest {
  adminReply: string;
}

// ─── messages ──────────────────────────────────────────────────────────────

export interface AdminMessageDto {
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  status: string;
  createdAt: string;
}

export interface AdminMessageListQuery {
  status?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminMessageListResponse {
  items: AdminMessageDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminMessageStatusRequest {
  status: "new" | "in_progress" | "replied" | "closed";
}

// ─── newsletter ────────────────────────────────────────────────────────────

export interface AdminNewsletterDto {
  id: string;
  email: string;
  subscribedAt: string;
  unsubscribedAt: string | null;
}

export interface AdminNewsletterListQuery {
  q?: string;
  activeOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminNewsletterListResponse {
  items: AdminNewsletterDto[];
  page: number;
  pageSize: number;
  total: number;
}
