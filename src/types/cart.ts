/**
 * Wire types for /api/cart endpoints.
 * Mirror in ui/src/lib/api-types.ts.
 */

import type { Collection, Family, I18nString } from "./products.js";

export interface CartItemDto {
  id: string;
  variantId: string;
  productId: string;
  slug: string;
  name: I18nString;
  image: string | null;
  collection: Collection;
  family: Family;
  sizeMl: number;
  sku: string;
  /** paise */
  unitPrice: number;
  qty: number;
  /** paise — unitPrice * qty (server-computed) */
  lineTotal: number;
  /** variant currently active + stock > 0 */
  inStock: boolean;
  availableStock: number;
}

export interface CartDto {
  id: string;
  items: CartItemDto[];
  /** paise — sum of lineTotal */
  subtotalPrice: number;
  itemCount: number;
  updatedAt: string;
}

export interface AddCartItemRequest {
  variantId: string;
  qty?: number;
}

export interface UpdateCartItemRequest {
  qty: number;
}
