import { prisma } from "../lib/prisma.js";
import type { Collection, Family, Mood, Occasion, ProductListItemDto } from "../types/products.js";
import type { ScentFinderMatchResponse } from "../types/scentFinder.js";
import { pickPrimaryImage } from "./productImage.js";

const MATCH_LIMIT = 3;

interface MatchInput {
  mood: Mood;
  occasion: Occasion;
  family: Family;
  collection?: Collection;
}

interface ScoredCandidate {
  product: Awaited<ReturnType<typeof loadCandidates>>[number];
  score: number;
}

/**
 * Scoring per spec:
 *  - mood includes user mood     → +2
 *  - occasion includes user occ  → +2
 *  - family matches user family  → +3
 *  - collection matches (if set) → +1
 *
 * Tiebreakers: isFeatured DESC, createdAt DESC.
 */
function score(p: ScoredCandidate["product"], input: MatchInput): number {
  let s = 0;
  if (p.moods.includes(input.mood)) s += 2;
  if (p.occasions.includes(input.occasion)) s += 2;
  if (p.family === input.family) s += 3;
  if (input.collection && p.collection === input.collection) s += 1;
  return s;
}

async function loadCandidates() {
  // Broad fetch then in-memory rank. Catalog is small (10-50 SKUs at launch),
  // so this avoids an unindexable JSON-array search in SQL.
  return prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    include: {
      variants: {
        where: { isActive: true, deletedAt: null },
        include: { images: true },
      },
    },
  });
}

function toListItemDto(p: Awaited<ReturnType<typeof loadCandidates>>[number]): ProductListItemDto {
  const variants = p.variants
    .slice()
    .sort((a, b) => a.sizeMl - b.sizeMl)
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      sizeMl: v.sizeMl,
      price: v.price,
      inStock: v.stock > 0,
    }));

  const primary = pickPrimaryImage(p.variants);
  const primaryImage = primary
    ? {
        id: primary.id,
        variantId: primary.variantId,
        url: primary.url,
        alt:
          primary.alt && typeof primary.alt === "object" && !Array.isArray(primary.alt)
            ? {
                en: typeof (primary.alt as Record<string, unknown>).en === "string" ? ((primary.alt as Record<string, unknown>).en as string) : "",
                ar: typeof (primary.alt as Record<string, unknown>).ar === "string" ? ((primary.alt as Record<string, unknown>).ar as string) : "",
              }
            : null,
      }
    : null;

  const prices = variants.map((v) => v.price);
  const minPrice = prices.length ? Math.min(...prices) : null;

  const name = p.name && typeof p.name === "object" && !Array.isArray(p.name)
    ? {
        en: typeof (p.name as Record<string, unknown>).en === "string" ? ((p.name as Record<string, unknown>).en as string) : "",
        ar: typeof (p.name as Record<string, unknown>).ar === "string" ? ((p.name as Record<string, unknown>).ar as string) : "",
      }
    : { en: "", ar: "" };

  return {
    id: p.id,
    slug: p.slug,
    name,
    collection: p.collection,
    tier: p.tier,
    family: p.family,
    longevity: p.longevity,
    sillage: p.sillage,
    isFeatured: p.isFeatured,
    primaryImage,
    variants,
    minPrice,
  };
}

export async function match(input: MatchInput): Promise<ScentFinderMatchResponse> {
  const candidates = await loadCandidates();
  const scored: ScoredCandidate[] = candidates.map((p) => ({
    product: p,
    score: score({ ...p, moods: p.moods, occasions: p.occasions }, input),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (Number(b.product.isFeatured) !== Number(a.product.isFeatured)) {
      return Number(b.product.isFeatured) - Number(a.product.isFeatured);
    }
    return b.product.createdAt.getTime() - a.product.createdAt.getTime();
  });

  // Score 0 implies zero overlap — still allowed (catalog may be tiny). Cap at 3.
  const top = scored.slice(0, MATCH_LIMIT).map((s) => toListItemDto(s.product));
  return { items: top };
}
