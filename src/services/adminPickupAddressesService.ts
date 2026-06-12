import type { PickupAddress } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import type {
  AdminPickupAddressDto,
  AdminPickupAddressListResponse,
  AdminPickupAddressPatchRequest,
  AdminPickupAddressUpsertRequest,
} from "../types/admin.js";

function toDto(p: PickupAddress): AdminPickupAddressDto {
  return {
    id: p.id,
    label: p.label,
    contactName: p.contactName,
    phone: p.phone,
    line1: p.line1,
    line2: p.line2,
    city: p.city,
    state: p.state,
    pincode: p.pincode,
    country: p.country,
    providerPickupId: p.providerPickupId,
    isDefault: p.isDefault,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function list(
  query: { page?: number; pageSize?: number } = {},
): Promise<AdminPickupAddressListResponse> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const [rows, total] = await Promise.all([
    prisma.pickupAddress.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pickupAddress.count(),
  ]);
  return { items: rows.map(toDto), page, pageSize, total };
}

export async function detail(id: string): Promise<AdminPickupAddressDto> {
  const p = await prisma.pickupAddress.findUnique({ where: { id } });
  if (!p) throw new HttpError(404, "NOT_FOUND", "Pickup address not found");
  return toDto(p);
}

export async function create(input: AdminPickupAddressUpsertRequest): Promise<AdminPickupAddressDto> {
  const existingCount = await prisma.pickupAddress.count();
  // First-ever pickup auto-defaults so admin doesn't have to remember the toggle.
  const shouldDefault = input.isDefault === true || existingCount === 0;

  const created = await prisma.$transaction(async (tx) => {
    if (shouldDefault) {
      await tx.pickupAddress.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    return tx.pickupAddress.create({
      data: {
        label: input.label,
        contactName: input.contactName,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city,
        state: input.state,
        pincode: input.pincode,
        country: input.country ?? "India",
        providerPickupId: input.providerPickupId ?? null,
        isDefault: shouldDefault,
      },
    });
  });
  return toDto(created);
}

export async function patch(
  id: string,
  input: AdminPickupAddressPatchRequest,
): Promise<AdminPickupAddressDto> {
  const existing = await prisma.pickupAddress.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Pickup address not found");

  const updated = await prisma.$transaction(async (tx) => {
    if (input.isDefault === true && !existing.isDefault) {
      await tx.pickupAddress.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    return tx.pickupAddress.update({
      where: { id },
      data: {
        label: input.label ?? undefined,
        contactName: input.contactName ?? undefined,
        phone: input.phone ?? undefined,
        line1: input.line1 ?? undefined,
        line2: input.line2 === undefined ? undefined : input.line2,
        city: input.city ?? undefined,
        state: input.state ?? undefined,
        pincode: input.pincode ?? undefined,
        country: input.country ?? undefined,
        providerPickupId:
          input.providerPickupId === undefined ? undefined : input.providerPickupId,
        isDefault: input.isDefault === undefined ? undefined : input.isDefault,
      },
    });
  });
  return toDto(updated);
}

export async function remove(id: string): Promise<{ ok: true }> {
  const existing = await prisma.pickupAddress.findUnique({
    where: { id },
    include: { _count: { select: { shipments: true } } },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Pickup address not found");
  // FK is onDelete: SetNull on Shipment, but we still want to block hard
  // deletes so history stays clean — admin can flip default to another row.
  if (existing._count.shipments > 0) {
    throw new HttpError(
      409,
      "PICKUP_ADDRESS_IN_USE",
      "Pickup address has shipments and cannot be deleted",
    );
  }
  await prisma.pickupAddress.delete({ where: { id } });
  return { ok: true };
}
