import { env } from "../../env.js";
import { prisma } from "../../lib/prisma.js";
import { DEFAULT_PACKAGE } from "../../constants/site.js";
import { getShippingProvider } from "./index.js";

export interface PackageDimensions {
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
}

/** Per-line dims (nullable per-SKU values; DEFAULT_PACKAGE fills the gaps). */
export interface PackageItem {
  weightGrams: number | null;
  lengthCm: number | null;
  breadthCm: number | null;
  heightCm: number | null;
  qty: number;
}

/**
 * Envelope package for a set of lines: weight = Σ(unit weight × qty), footprint
 * = max(L) × max(B), height = Σ(unit height × qty) (stacked). Over-estimating
 * dims is safe — higher volumetric weight never under-charges freight. Shared by
 * the customer checkout delivery-check and the admin ship/rate-shop form.
 */
export function computePackage(items: PackageItem[]): PackageDimensions {
  return items.reduce<PackageDimensions>(
    (acc, i) => {
      const w = i.weightGrams ?? DEFAULT_PACKAGE.weightGrams;
      const l = i.lengthCm ?? DEFAULT_PACKAGE.lengthCm;
      const b = i.breadthCm ?? DEFAULT_PACKAGE.breadthCm;
      const h = i.heightCm ?? DEFAULT_PACKAGE.heightCm;
      return {
        weightGrams: acc.weightGrams + w * i.qty,
        lengthCm: Math.max(acc.lengthCm, l),
        breadthCm: Math.max(acc.breadthCm, b),
        heightCm: acc.heightCm + h * i.qty,
      };
    },
    { weightGrams: 0, lengthCm: 0, breadthCm: 0, heightCm: 0 },
  );
}

export interface DeliveryInfo {
  /** false only when a live rate-shop returns zero serviceable couriers */
  serviceable: boolean;
  /** cheapest-courier ETA in days; null in manual mode / provider error / not run */
  estimatedDeliveryDays: number | null;
}

// Serviceability + ETA change slowly (per zone). Cache by (pickup, delivery,
// weight bucket) so an undeliverable PIN or a date estimate isn't re-fetched on
// every cart/address edit. In-memory: fine for a single node; swap for Redis if
// the API scales horizontally.
const CACHE_TTL_MS = 30 * 60 * 1000;
const WEIGHT_BUCKET_G = 250;
const cache = new Map<string, { value: DeliveryInfo; expires: number }>();

const SERVICEABLE_UNKNOWN: DeliveryInfo = {
  serviceable: true,
  estimatedDeliveryDays: null,
};

/**
 * Serviceability + delivery-date for a cart, used only to (a) block undeliverable
 * pincodes and (b) show "delivery by X" at checkout. It does NOT price shipping —
 * the customer charge is flat / free-over-threshold (see promotionsService).
 * Never throws: a provider outage degrades to "serviceable, no ETA" so checkout
 * is never blocked by shipping infrastructure.
 */
export async function checkDelivery(params: {
  deliveryPincode: string | null;
  pkg: PackageDimensions;
  declaredValuePaise: number;
}): Promise<DeliveryInfo> {
  if (env.SHIPPING_PROVIDER === "manual" || !params.deliveryPincode) {
    return SERVICEABLE_UNKNOWN;
  }

  const provider = getShippingProvider();
  if (!provider.isEnabled()) return SERVICEABLE_UNKNOWN;

  const pickup = await prisma.pickupAddress.findFirst({
    where: { isDefault: true },
    select: { pincode: true },
  });
  if (!pickup) return SERVICEABLE_UNKNOWN;

  const weightBucket =
    Math.ceil(params.pkg.weightGrams / WEIGHT_BUCKET_G) * WEIGHT_BUCKET_G;
  const cacheKey = `${pickup.pincode}:${params.deliveryPincode}:${weightBucket}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > now) return cached.value;

  let options;
  try {
    options = await provider.rateShop({
      pickupPincode: pickup.pincode,
      deliveryPincode: params.deliveryPincode,
      weightG: params.pkg.weightGrams,
      lengthCm: params.pkg.lengthCm,
      breadthCm: params.pkg.breadthCm,
      heightCm: params.pkg.heightCm,
      declaredValuePaise: params.declaredValuePaise,
    });
  } catch {
    // Don't block checkout on a provider outage — assume serviceable, no ETA.
    return SERVICEABLE_UNKNOWN;
  }

  let result: DeliveryInfo;
  if (options.length === 0) {
    result = { serviceable: false, estimatedDeliveryDays: null };
  } else {
    // Fastest available ETA across serviceable couriers (the optimistic promise).
    const days = options
      .map((o) => o.estimatedDeliveryDays)
      .filter((d): d is number => d != null);
    result = {
      serviceable: true,
      estimatedDeliveryDays: days.length > 0 ? Math.min(...days) : null,
    };
  }
  cache.set(cacheKey, { value: result, expires: now + CACHE_TTL_MS });
  return result;
}
