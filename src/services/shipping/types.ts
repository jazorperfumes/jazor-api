import type { ShipmentStatus } from "../../types/orders.js";

// ─── rate-shop ─────────────────────────────────────────────────────────────

export interface RateShopInput {
  pickupPincode: string;
  deliveryPincode: string;
  weightG: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  /** Order total paise — used by carriers to compute insurance/freight. */
  declaredValuePaise: number;
  /** 0 unless COD; currently always 0 since we're Prepaid-only. */
  codAmountPaise?: number;
}

export interface CourierOption {
  courierId: number;
  courierName: string;
  /** paise */
  freightChargesPrice: number;
  /** paise */
  codChargesPrice: number;
  estimatedDeliveryDays: number | null;
  /** Higher = better (provider supplies; null if not present). */
  rating: number | null;
}

// ─── create shipment ───────────────────────────────────────────────────────

export interface CreateShipmentItem {
  name: string;
  sku: string;
  units: number;
  /** paise */
  sellingPrice: number;
}

export interface PickupAddressInput {
  /** Provider-side warehouse / pickup-location identifier (e.g. NimbusPost warehouse_name). */
  locationId: string;
  contactName: string;
  phone: string;
  email?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface CreateShipmentInput {
  orderNumber: string;
  orderDate: string; // YYYY-MM-DD
  pickup: PickupAddressInput;
  billing: {
    customerName: string;
    address: string;
    line2?: string | null;
    city: string;
    pincode: string;
    state: string;
    country: string;
    phone: string;
    email?: string;
  };
  items: CreateShipmentItem[];
  /** paise */
  subTotal: number;
  weightG: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  courierId: number;
}

export interface CreateShipmentResult {
  providerShipmentId: string;
  awb: string;
  courierName: string;
  courierId: number;
  labelUrl: string | null;
  trackingUrl: string | null;
  /** paise */
  freightChargesPrice: number;
  /** paise */
  codChargesPrice: number;
  raw: unknown;
}

// ─── cancel shipment ───────────────────────────────────────────────────────

export interface CancelShipmentResult {
  cancelled: string[];
  failed: string[];
}

// ─── webhook ───────────────────────────────────────────────────────────────

export interface WebhookEvent {
  /** Stable identifier used for idempotency keying. */
  eventId: string;
  /** Provider event name, e.g. "shipment.delivered". */
  eventType: string;
  /** awb_code / awb_number, used to resolve our Shipment row. */
  awb?: string;
  providerShipmentId?: string;
  status: ShipmentStatus;
  description?: string | null;
  location?: string | null;
  occurredAt: Date;
  deliveredTo?: string | null;
  raw: unknown;
}

// ─── provider contract ─────────────────────────────────────────────────────

export interface ShippingProvider {
  /** Slug stored in `Shipment.provider`. */
  readonly name: string;
  /** False when env creds are absent — admin should fall back to manual ship. */
  isEnabled(): boolean;

  rateShop(input: RateShopInput): Promise<CourierOption[]>;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancelShipment(awb: string, reason: string): Promise<CancelShipmentResult>;

  /** Verify HMAC (or equivalent) over raw bytes. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Parse a verified webhook payload into our canonical event. Null if irrelevant. */
  parseWebhookEvent(rawBody: Buffer, signature: string | undefined): WebhookEvent | null;
}
