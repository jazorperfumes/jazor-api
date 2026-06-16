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
