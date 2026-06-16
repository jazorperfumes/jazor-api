import crypto from "node:crypto";
import { env } from "../../env.js";
import { HttpError } from "../../middleware/error.js";
import { logger } from "../../lib/logger.js";
import type { ShipmentStatus } from "../../types/orders.js";
import type {
  CancelShipmentResult,
  CourierOption,
  CreateShipmentInput,
  CreateShipmentResult,
  RateShopInput,
  ShippingProvider,
  WebhookEvent,
} from "./types.js";

// NimbusPost responses wrap data in { status, message, data }. The `status`
// field is a boolean (their docs are inconsistent — sometimes "Success" string,
// usually `true|false`), so we treat it loosely.
interface NpResponse<T> {
  status?: boolean | string;
  message?: string;
  data?: T;
}

// NimbusPost login response: `{ status, message, data: "<JWT>" }`. Some
// account tiers/legacy responses wrap it as `data: { token: "<JWT>" }` so we
// accept both shapes.
type NpLoginData = string | { token?: string };

interface NpCourier {
  id?: number | string;
  courier_id?: number | string;
  name?: string;
  courier_name?: string;
  total_charges?: number | string;
  cod_charges?: number | string;
  estimated_delivery_days?: number | string;
  edd?: number | string;
  rating?: number | string;
}

interface NpServiceabilityData {
  data?: NpCourier[];
}

interface NpCreateShipmentData {
  awb_number?: string;
  shipment_id?: number | string;
  courier_id?: number | string;
  courier_name?: string;
  label?: string;
  tracking_url?: string;
  freight_charges?: number | string;
  cod_charges?: number | string;
}

interface NpCancelData {
  awb?: string;
  awb_number?: string;
}

interface NpWebhookBody {
  awb?: string;
  awb_number?: string;
  shipment_id?: number | string;
  status?: string;
  status_code?: string;
  current_location?: string;
  activity?: string;
  remarks?: string;
  delivered_to?: string;
  delivery_timestamp?: string;
  timestamp?: string;
  event?: string;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

// ─── implementation ────────────────────────────────────────────────────────

export class NimbusPostProvider implements ShippingProvider {
  readonly name = "nimbuspost";

  // NimbusPost JWT TTL is ~24h. Cache and refresh just before expiry.
  private cachedToken: string | null = null;
  private cachedTokenExpiresAt = 0;
  private static readonly TOKEN_TTL_MS = 23 * 60 * 60 * 1000;

  isEnabled(): boolean {
    return Boolean(
      env.NIMBUSPOST_EMAIL && env.NIMBUSPOST_PASSWORD && env.NIMBUSPOST_BASE_URL,
    );
  }

  private ensureEnabled() {
    if (!this.isEnabled()) {
      throw new HttpError(
        503,
        "SHIPMENT_PROVIDER_DISABLED",
        "NimbusPost not configured",
      );
    }
  }

  private async getToken(): Promise<string> {
    this.ensureEnabled();
    const now = Date.now();
    if (this.cachedToken && now < this.cachedTokenExpiresAt) {
      return this.cachedToken;
    }
    const res = await fetch(`${env.NIMBUSPOST_BASE_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: env.NIMBUSPOST_EMAIL,
        password: env.NIMBUSPOST_PASSWORD,
      }),
    });
    const text = await res.text();
    let json: NpResponse<NpLoginData>;
    try {
      json = text ? (JSON.parse(text) as NpResponse<NpLoginData>) : {};
    } catch {
      logger.error("NimbusPost login non-JSON response", new Error(text), {
        status: res.status,
      });
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        "NimbusPost returned malformed login response",
      );
    }
    const token =
      typeof json.data === "string"
        ? json.data
        : typeof json.data === "object" && json.data !== null
          ? json.data.token
          : undefined;
    if (!res.ok || json.status === false || !token) {
      logger.error(
        "NimbusPost login failed",
        new Error(json.message ?? text),
        { status: res.status, body: text },
      );
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        json.message ?? "NimbusPost authentication failed",
      );
    }
    this.cachedToken = token;
    this.cachedTokenExpiresAt = now + NimbusPostProvider.TOKEN_TTL_MS;
    return token;
  }

  private async npPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${env.NIMBUSPOST_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: NpResponse<T>;
    try {
      json = text ? (JSON.parse(text) as NpResponse<T>) : ({} as NpResponse<T>);
    } catch {
      logger.error("NimbusPost non-JSON response", new Error(text), {
        path,
        status: res.status,
      });
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        "NimbusPost returned malformed response",
      );
    }
    const ok = res.ok && json.status !== false;
    if (!ok) {
      logger.error("NimbusPost call failed", new Error(json.message ?? text), {
        path,
        status: res.status,
      });
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        json.message ?? "NimbusPost request failed",
      );
    }
    return (json.data ?? (json as unknown as T)) as T;
  }

  // ─── rate-shop ───────────────────────────────────────────────────────────

  async rateShop(input: RateShopInput): Promise<CourierOption[]> {
    const body = {
      origin: input.pickupPincode,
      destination: input.deliveryPincode,
      payment_type: (input.codAmountPaise ?? 0) > 0 ? "cod" : "prepaid",
      order_amount: paiseToRupees(input.declaredValuePaise),
      weight: input.weightG,
      length: input.lengthCm,
      breadth: input.breadthCm,
      height: input.heightCm,
    };
    const data = await this.npPost<NpServiceabilityData | NpCourier[]>(
      "/courier/serviceability",
      body,
    );
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as NpServiceabilityData).data)
        ? (data as NpServiceabilityData).data ?? []
        : [];
    return list.map<CourierOption>((c) => ({
      courierId: toNumber(c.id ?? c.courier_id, 0),
      courierName: c.name ?? c.courier_name ?? "Unknown",
      freightChargesPrice: rupeesToPaise(toNumber(c.total_charges, 0)),
      codChargesPrice: rupeesToPaise(toNumber(c.cod_charges, 0)),
      estimatedDeliveryDays:
        c.estimated_delivery_days !== undefined || c.edd !== undefined
          ? toNumber(c.estimated_delivery_days ?? c.edd, 0)
          : null,
      rating: c.rating !== undefined ? toNumber(c.rating, 0) : null,
    }));
  }

  // ─── create shipment ─────────────────────────────────────────────────────

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const body = {
      order_number: input.orderNumber,
      payment_type: "prepaid",
      order_amount: paiseToRupees(input.subTotal),
      package_weight: input.weightG,
      package_length: input.lengthCm,
      package_breadth: input.breadthCm,
      package_height: input.heightCm,
      request_auto_pickup: "yes",
      consignee: {
        name: input.billing.customerName,
        address: input.billing.address,
        address_2: input.billing.line2 ?? "",
        city: input.billing.city,
        state: input.billing.state,
        pincode: input.billing.pincode,
        country: input.billing.country,
        phone: input.billing.phone,
        email: input.billing.email ?? "",
      },
      pickup: {
        warehouse_name: input.pickup.locationId,
        name: input.pickup.contactName,
        address: input.pickup.line1,
        address_2: input.pickup.line2 ?? "",
        city: input.pickup.city,
        state: input.pickup.state,
        pincode: input.pickup.pincode,
        country: input.pickup.country,
        phone: input.pickup.phone,
        email: input.pickup.email ?? "",
      },
      order_items: input.items.map((it) => ({
        name: it.name,
        sku: it.sku,
        qty: it.units,
        price: paiseToRupees(it.sellingPrice),
      })),
      courier_id: input.courierId,
    };

    const data = await this.npPost<NpCreateShipmentData>("/shipments", body);
    const awb = data?.awb_number;
    if (!awb) {
      throw new HttpError(
        502,
        "SHIPMENT_PROVIDER_ERROR",
        "NimbusPost response missing awb_number",
      );
    }
    return {
      providerShipmentId: String(data.shipment_id ?? awb),
      awb: String(awb),
      courierName: data.courier_name ?? "",
      courierId: toNumber(data.courier_id ?? input.courierId, input.courierId),
      labelUrl: data.label ?? null,
      trackingUrl: data.tracking_url ?? null,
      freightChargesPrice: rupeesToPaise(toNumber(data.freight_charges, 0)),
      codChargesPrice: rupeesToPaise(toNumber(data.cod_charges, 0)),
      raw: data,
    };
  }

  // ─── cancel shipment ─────────────────────────────────────────────────────

  async cancelShipment(awb: string, _reason: string): Promise<CancelShipmentResult> {
    const data = await this.npPost<NpCancelData | { awbs?: string[] }>(
      "/shipments/cancel",
      { awb },
    );
    // NimbusPost returns either { awb: "..." } per-cancel or { awbs: [...] }
    // depending on endpoint version. Treat any 2xx with the awb echoed back
    // (or no failure field) as success.
    const echoed = (data as NpCancelData)?.awb ?? (data as NpCancelData)?.awb_number;
    const list = (data as { awbs?: string[] })?.awbs;
    const cancelled = Array.isArray(list)
      ? list
      : echoed
        ? [String(echoed)]
        : [awb];
    return { cancelled, failed: [] };
  }

  // ─── webhook ─────────────────────────────────────────────────────────────

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature || !env.NIMBUSPOST_WEBHOOK_SECRET) return false;
    const expected = crypto
      .createHmac("sha256", env.NIMBUSPOST_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(
    rawBody: Buffer,
    signature: string | undefined,
  ): WebhookEvent | null {
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new HttpError(400, "SIGNATURE_INVALID", "Webhook signature invalid");
    }
    let parsed: NpWebhookBody;
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as NpWebhookBody;
    } catch {
      throw new HttpError(400, "VALIDATION_ERROR", "Webhook body not JSON");
    }
    const awb = parsed.awb ?? parsed.awb_number;
    const providerShipmentId =
      parsed.shipment_id !== undefined ? String(parsed.shipment_id) : undefined;
    if (!awb && !providerShipmentId) return null;

    const ts = parsed.timestamp ?? parsed.delivery_timestamp;
    const occurredAt = ts ? new Date(ts) : new Date();
    const eventType = parsed.event ?? "shipment.update";
    // Idempotency key must be stable across provider retries. Derive it from
    // shipment id + status (NOT wall-clock) so a retried event with no timestamp
    // doesn't generate a fresh id and duplicate the ShipmentEvent row.
    const statusKey = String(parsed.status_code ?? parsed.status ?? "unknown")
      .trim()
      .toUpperCase();
    const eventId = `nimbuspost:${eventType}:${awb ?? providerShipmentId}:${statusKey}`;

    return {
      eventId,
      eventType,
      awb: awb ? String(awb) : undefined,
      providerShipmentId,
      status: mapStatus(parsed.status_code, parsed.status),
      description: parsed.activity ?? parsed.remarks ?? parsed.status ?? null,
      location: parsed.current_location ?? null,
      occurredAt,
      deliveredTo: parsed.delivered_to ?? null,
      raw: parsed,
    };
  }
}

/**
 * NimbusPost → our enum. Both `status_code` (numeric/string per docs) and the
 * `status` text are tried. Unknown codes degrade to IN_TRANSIT so events aren't
 * lost on schema drift.
 */
function mapStatus(
  code: string | undefined,
  statusText: string | undefined,
): ShipmentStatus {
  const c = (code ?? "").toUpperCase();
  switch (c) {
    case "DL":
    case "DLV":
    case "DELIVERED":
      return "DELIVERED";
    case "IT":
    case "INT":
    case "IN_TRANSIT":
      return "IN_TRANSIT";
    case "PU":
    case "PKD":
    case "PCK":
    case "PICKED_UP":
      return "PICKED_UP";
    case "OFD":
    case "OUT":
    case "OUT_FOR_DELIVERY":
      return "OUT_FOR_DELIVERY";
    case "RT":
    case "RTO":
    case "RTD":
      return "RTO";
    case "CN":
    case "CAN":
    case "CNCL":
    case "CANCELLED":
      return "CANCELLED";
    case "MN":
    case "MNF":
    case "MAN":
    case "MANIFESTED":
      return "MANIFESTED";
  }
  const s = (statusText ?? "").toLowerCase();
  if (!s) return "IN_TRANSIT";
  if (s.includes("deliver")) return "DELIVERED";
  if (s.includes("out for")) return "OUT_FOR_DELIVERY";
  if (s.includes("picked")) return "PICKED_UP";
  if (s.includes("rto") || s.includes("return")) return "RTO";
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("manifest")) return "MANIFESTED";
  if (s.includes("transit")) return "IN_TRANSIT";
  return "IN_TRANSIT";
}
