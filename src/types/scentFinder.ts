import type { Collection, Family, Mood, Occasion, ProductListItemDto } from "./products.js";

export interface ScentFinderMatchRequest {
  mood: Mood;
  occasion: Occasion;
  family: Family;
  collection?: Collection;
}

export interface ScentFinderMatchResponse {
  items: ProductListItemDto[];
}
