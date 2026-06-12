/**
 * Wire types for /api/account/wishlist endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { ProductListItemDto } from "./products.js";

export interface WishlistResponse {
  items: ProductListItemDto[];
}

export interface AddWishlistRequest {
  productId: string;
}
