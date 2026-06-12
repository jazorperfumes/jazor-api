import { env } from "../../env.js";
import { HttpError } from "../../middleware/error.js";
import { NimbusPostProvider } from "./nimbusPostProvider.js";
import type { ShippingProvider } from "./types.js";

let cached: ShippingProvider | null = null;

export function getShippingProvider(): ShippingProvider {
  if (cached) return cached;
  switch (env.SHIPPING_PROVIDER) {
    case "nimbuspost":
      cached = new NimbusPostProvider();
      return cached;
    default:
      throw new HttpError(
        503,
        "SHIPMENT_PROVIDER_DISABLED",
        `Unknown SHIPPING_PROVIDER=${env.SHIPPING_PROVIDER}`,
      );
  }
}

export type { ShippingProvider } from "./types.js";
export type {
  CancelShipmentResult,
  CourierOption,
  CreateShipmentInput,
  CreateShipmentItem,
  CreateShipmentResult,
  RateShopInput,
  WebhookEvent,
} from "./types.js";
