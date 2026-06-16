/**
 * Site-wide bilingual strings. Edit here (requires redeploy) rather than env
 * so multi-line / UTF-8 prose stays readable. Numeric constants live in env.ts.
 */

export const siteCopy = {
  bannerText: {
    en: "Free shipping on orders above ₹1,999.",
    ar: "شحن مجاني للطلبات التي تزيد عن ١٬٩٩٩ روبية.",
  },
} as const;

/** Hard ceiling on units of a single variant in one cart line. */
export const MAX_CART_QTY = 10;

/**
 * Fallback packaged dimensions for a single unit when a variant has no
 * weight/dims set yet. Ship + rate-shop use this so a shipment never blocks on
 * missing data; admin backfills real per-SKU values over time.
 */
export const DEFAULT_PACKAGE = {
  weightGrams: 350,
  lengthCm: 14,
  breadthCm: 9,
  heightCm: 6,
} as const;
