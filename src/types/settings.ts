import type { I18nString } from "./products.js";

export interface PublicSettingsDto {
  /** paise */
  flatShippingPaise: number;
  /** paise */
  giftWrapPaise: number;
  bannerText: I18nString;
  whatsappNumber: string;
  supportEmail: string;
}
