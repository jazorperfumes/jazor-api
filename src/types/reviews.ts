/**
 * Wire types for /api/account/reviews endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { ReviewDto } from "./products.js";

export interface CreateReviewRequest {
  orderItemId: string;
  rating: number;
  title?: string;
  body: string;
}

export interface ReviewMutationResponse {
  review: ReviewDto;
}
