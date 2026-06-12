/**
 * Wire types for /api/account/refund-claims + /api/admin/refund-claims.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { I18nString } from "./products.js";

export type RefundClaimReasonCode = "DAMAGED_BOTTLE";

export type RefundClaimKind = "PRE_SHIP_CANCEL" | "DAMAGE_CLAIM";

export type RefundClaimStatus =
  | "REQUESTED"
  | "REJECTED"
  | "APPROVED"
  | "PENDING"
  | "PROCESSED"
  | "FAILED";

export interface RefundClaimImageDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface RefundClaimDto {
  id: string;
  orderId: string;
  orderNumber: string;
  orderItemId: string | null;
  itemName: I18nString | null;
  itemImage: string | null;
  itemSizeMl: number | null;
  itemSku: string | null;
  kind: RefundClaimKind;
  reasonCode: RefundClaimReasonCode | null;
  userDescription: string | null;
  reviewNote: string | null;
  amountPrice: number;
  status: RefundClaimStatus;
  reviewedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  images: RefundClaimImageDto[];
}

export interface RefundClaimSummaryDto {
  id: string;
  orderItemId: string;
  status: RefundClaimStatus;
  reasonCode: RefundClaimReasonCode | null;
  amountPrice: number;
  createdAt: string;
}

export interface RefundClaimListResponse {
  items: RefundClaimDto[];
  page: number;
  pageSize: number;
  total: number;
}

export interface RefundClaimReviewRequest {
  reviewNote?: string;
}

export interface RefundClaimRejectRequest {
  reviewNote: string;
}
