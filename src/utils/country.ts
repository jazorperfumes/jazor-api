import { createRequire } from "node:module";
import countries from "i18n-iso-countries";
import { HttpError } from "../middleware/error.js";

const require = createRequire(import.meta.url);
const enLocale = require("i18n-iso-countries/langs/en.json");
countries.registerLocale(enLocale);

const SUPPORTED_ALPHA2 = new Set(["IN"]);

/**
 * Normalize free-form country input to canonical English name.
 * Accepts alpha-2 ("IN"), alpha-3 ("IND"), or name ("india", "India", "INDIA").
 * Throws ADDRESS_INVALID if unknown or not a currently-supported country.
 */
export function normalizeCountry(input: string | undefined | null): string {
  const raw = (input ?? "").trim();
  if (!raw) throw new HttpError(400, "ADDRESS_INVALID", "Country required");

  let alpha2: string | undefined;
  const upper = raw.toUpperCase();

  if (upper.length === 2 && countries.isValid(upper)) {
    alpha2 = upper;
  } else if (upper.length === 3) {
    alpha2 = countries.alpha3ToAlpha2(upper);
  }
  if (!alpha2) {
    alpha2 = countries.getAlpha2Code(raw, "en");
  }

  if (!alpha2) {
    throw new HttpError(400, "ADDRESS_INVALID", `Unknown country: ${raw}`);
  }
  if (!SUPPORTED_ALPHA2.has(alpha2)) {
    throw new HttpError(400, "ADDRESS_INVALID", "We currently ship only to India");
  }

  const canonical = countries.getName(alpha2, "en");
  if (!canonical || typeof canonical !== "string") {
    throw new HttpError(400, "ADDRESS_INVALID", "Country normalization failed");
  }
  return canonical;
}
