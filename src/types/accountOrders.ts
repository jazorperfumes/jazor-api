/**
 * Wire types for /api/account/orders endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { I18nString } from "./products.js";
import type { OrderStatus } from "./orders.js";

export interface OrderListQuery {
  status?: OrderStatus;
  page?: number;
  pageSize?: number;
}

export interface OrderListPreviewItemDto {
  name: I18nString;
  image: string | null;
  sizeMl: number;
  qty: number;
  slug: string;
}

export interface OrderListItemDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  placedAt: string;
  /** paise */
  totalPrice: number;
  itemCount: number;
  /** Up to 2 line items for the list card. */
  previewItems: OrderListPreviewItemDto[];
}

export interface OrderListResponse {
  items: OrderListItemDto[];
  page: number;
  pageSize: number;
  total: number;
}

export type CancelRefundStatus = "PROCESSED" | "PENDING" | "FAILED" | "NONE";

export interface CancelOrderResponse {
  orderId: string;
  status: OrderStatus;
  refund: {
    status: CancelRefundStatus;
    /** paise — present when refund was attempted */
    amountPrice?: number;
  };
}
