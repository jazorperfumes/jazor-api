import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type { TrackOrderDto, TrackOrderItemDto, TrackShipmentDto } from "../types/track.js";

interface ProductSnapshot {
  name?: { en?: string; ar?: string } | string;
  sizeMl?: number;
}

function readSnapshot(value: unknown): { name: { en: string; ar: string }; sizeMl: number } {
  if (!value || typeof value !== "object") {
    return { name: { en: "", ar: "" }, sizeMl: 0 };
  }
  const s = value as ProductSnapshot;
  let name: { en: string; ar: string } = { en: "", ar: "" };
  if (typeof s.name === "object" && s.name !== null) {
    name = {
      en: typeof s.name.en === "string" ? s.name.en : "",
      ar: typeof s.name.ar === "string" ? s.name.ar : "",
    };
  } else if (typeof s.name === "string") {
    name = { en: s.name, ar: s.name };
  }
  return { name, sizeMl: typeof s.sizeMl === "number" ? s.sizeMl : 0 };
}

/**
 * Public order tracking. Both `orderNumber` and `email` must match to prevent
 * order enumeration. Failure responses are intentionally identical to a real
 * miss (NOT_FOUND) so existence cannot be probed.
 */
export async function get(orderNumber: string, email: string): Promise<TrackOrderDto> {
  const normalized = email.toLowerCase().trim();

  const order = await prisma.order.findFirst({
    where: {
      orderNumber,
      email: { equals: normalized, mode: "insensitive" },
    },
    include: {
      items: true,
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          events: { orderBy: { occurredAt: "asc" } },
        },
      },
    },
  });

  if (!order) throw new HttpError(404, "NOT_FOUND", "Order not found");

  const items: TrackOrderItemDto[] = order.items.map((it) => {
    const snap = readSnapshot(it.productSnapshot);
    return { name: snap.name, sizeMl: snap.sizeMl, qty: it.qty };
  });

  let shipment: TrackShipmentDto | null = null;
  const latest = order.shipments[0];
  if (latest) {
    shipment = {
      courier: latest.courierName,
      awb: latest.awb,
      trackingUrl: latest.trackingUrl,
      status: latest.status,
      events: latest.events.map((e) => ({
        status: e.status,
        description: e.description,
        location: e.location,
        occurredAt: e.occurredAt.toISOString(),
      })),
    };
  }

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    placedAt: order.placedAt.toISOString(),
    totalPrice: order.totalPrice,
    items,
    shipment,
  };
}
