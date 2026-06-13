import { Prisma } from "@prisma/client";

export interface ImageRow {
  id: string;
  variantId: string;
  url: string;
  alt: Prisma.JsonValue | null;
  position: number;
}

interface VariantWithImages {
  sizeMl: number;
  isActive: boolean;
  deletedAt: Date | null;
  images: ImageRow[];
}

/** First image (by position) of a single variant. */
export function firstImageOf(images: ImageRow[]): ImageRow | undefined {
  return images.slice().sort((a, b) => a.position - b.position)[0];
}

/**
 * Card/list primary image. Images are per-variant now, so the product's
 * "primary" is the first image of its default (smallest active) variant, with
 * a fall-through to any variant that has images.
 */
export function pickPrimaryImage(
  variants: VariantWithImages[],
): ImageRow | undefined {
  const ordered = variants
    .filter((v) => v.isActive && !v.deletedAt)
    .slice()
    .sort((a, b) => a.sizeMl - b.sizeMl);
  for (const v of ordered) {
    const img = firstImageOf(v.images);
    if (img) return img;
  }
  // last resort: any variant (e.g. all inactive)
  for (const v of variants) {
    const img = firstImageOf(v.images);
    if (img) return img;
  }
  return undefined;
}
