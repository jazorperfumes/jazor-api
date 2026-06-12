export type TrackOrderStatus =
  | "CREATED"
  | "PAID"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "REFUND_PROCESSING"
  | "CANCELLED"
  | "REFUNDED";

export type TrackShipmentStatus =
  | "CREATED"
  | "MANIFESTED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "RTO"
  | "CANCELLED";

export interface TrackShipmentEventDto {
  status: TrackShipmentStatus;
  description: string | null;
  location: string | null;
  occurredAt: string; // ISO
}

export interface TrackShipmentDto {
  courier: string | null;
  awb: string | null;
  trackingUrl: string | null;
  status: TrackShipmentStatus;
  events: TrackShipmentEventDto[];
}

export interface TrackOrderItemDto {
  name: { en: string; ar: string };
  sizeMl: number;
  qty: number;
}

export interface TrackOrderDto {
  orderNumber: string;
  status: TrackOrderStatus;
  placedAt: string; // ISO
  totalPrice: number; // paise
  items: TrackOrderItemDto[];
  shipment: TrackShipmentDto | null;
}
