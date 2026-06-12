import { env } from "../env.js";
import { siteCopy } from "../constants/site.js";
import type { PublicSettingsDto } from "../types/settings.js";

/** Static settings for MVP. Promote to DB-backed Setting model later. */
export function getPublic(): PublicSettingsDto {
  return {
    flatShippingPaise: env.FLAT_SHIPPING_PAISE,
    giftWrapPaise: env.GIFT_WRAP_PAISE,
    bannerText: { ...siteCopy.bannerText },
    whatsappNumber: env.WHATSAPP_NUMBER,
    supportEmail: env.SUPPORT_EMAIL,
  };
}
