/**
 * Wire types for /api/orders + /api/razorpay endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { I18nString, Collection, Family } from "./products.js";
import type { AddressInput } from "./address.js";
import type { AppliedPromotionDto } from "./promotion.js";
import type { GiftSelection } from "./checkout.js";

export type OrderStatus =
  | "CREATED"
  | "PAID"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "REFUND_PROCESSING"
  | "CANCELLED"
  | "REFUNDED";

export type PaymentStatus =
  | "CREATED"
  | "AUTHORIZED"
  | "CAPTURED"
  | "FAILED"
  | "REFUNDED";

export type ShipmentStatus =
  | "CREATED"
  | "MANIFESTED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "RTO"
  | "CANCELLED";

// ─── create order ─────────────────────────────────────────────────────────

export interface CreateOrderRequest {
  shippingAddressId?: string;
  shippingAddress?: AddressInput;
  saveAddress?: boolean;
  /** Mark saved address as default. Ignored unless saveAddress=true. */
  setDefaultAddress?: boolean;
  giftWrap?: boolean;
  giftMessage?: string;
  discountCodes?: string[];
  giftSelections?: GiftSelection[];
  notes?: string;
}

export interface OrderPrefillDto {
  email: string;
  name: string;
  contact: string;
}

export interface CreateOrderResponse {
  orderId: string;
  orderNumber: string;
  razorpayOrderId: string;
  razorpayKeyId: string;
  /** paise */
  amountPaise: number;
  currency: "INR";
  prefill: OrderPrefillDto;
}

// ─── order detail ─────────────────────────────────────────────────────────

export interface OrderItemDto {
  id: string;
  variantId: string | null;
  /** snapshot — product may have changed since purchase */
  name: I18nString;
  slug: string | null;
  image: string | null;
  sizeMl: number;
  sku: string;
  collection: Collection;
  family: Family;
  /** paise */
  unitPrice: number;
  qty: number;
  lineTotalPrice: number;
  isGift: boolean;
  hasReview: boolean;
}

export interface OrderAddressDto {
  contactName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface OrderPaymentDto {
  id: string;
  status: PaymentStatus;
  method: string | null;
  /** paise */
  amountPrice: number;
  capturedAt: string | null;
}

export interface OrderShipmentSummaryDto {
  id: string;
  status: ShipmentStatus;
  courier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface OrderDetailDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  /** expected delivery (placedAt + cheapest-courier ETA); null in manual mode */
  estimatedDeliveryAt: string | null;
  email: string;
  phone: string;
  shippingAddress: OrderAddressDto;
  giftWrap: boolean;
  giftMessage: string | null;
  notes: string | null;
  items: OrderItemDto[];
  /** paise */
  subtotalPrice: number;
  discountPrice: number;
  shippingPrice: number;
  giftWrapPrice: number;
  totalPrice: number;
  promotions: AppliedPromotionDto[];
  payment: OrderPaymentDto | null;
  shipment: OrderShipmentSummaryDto | null;
}

// ─── razorpay verify ──────────────────────────────────────────────────────

export interface RazorpayVerifyRequest {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface RazorpayVerifyResponse {
  orderId: string;
  orderNumber: string;
  status: "PAID";
}
