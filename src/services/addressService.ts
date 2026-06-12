import { prisma } from "../lib/prisma.js";
import { HttpError } from "../middleware/error.js";
import { normalizeCountry } from "../utils/country.js";
import {
  ADDRESS_MAX_PER_USER,
  type AddressDto,
  type AddressInput,
  type CreateAddressRequest,
  type UpdateAddressRequest,
} from "../types/address.js";
import type { Address } from "@prisma/client";

const PINCODE_RE = /^[0-9]{6}$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;

function assertShape(a: AddressInput): void {
  if (!a.contactName?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "Contact name required");
  if (!a.line1?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "Address line 1 required");
  if (!a.city?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "City required");
  if (!a.state?.trim()) throw new HttpError(400, "ADDRESS_INVALID", "State required");
  if (!PINCODE_RE.test(a.pincode)) throw new HttpError(400, "ADDRESS_INVALID", "Invalid pincode");
  if (!PHONE_RE.test(a.phone)) throw new HttpError(400, "ADDRESS_INVALID", "Invalid phone");
}

function toDto(a: Address): AddressDto {
  return {
    id: a.id,
    label: a.label,
    contactName: a.contactName,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    country: a.country,
    isDefaultShipping: a.isDefaultShipping,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export async function list(userId: string): Promise<AddressDto[]> {
  const rows = await prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefaultShipping: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map(toDto);
}

export async function create(
  userId: string,
  input: CreateAddressRequest,
): Promise<AddressDto> {
  const country = normalizeCountry(input.country);
  const payload: AddressInput = { ...input, country };
  assertShape(payload);

  const count = await prisma.address.count({ where: { userId } });
  if (count >= ADDRESS_MAX_PER_USER) {
    throw new HttpError(400, "ADDRESS_LIMIT", `Max ${ADDRESS_MAX_PER_USER} addresses per user`);
  }

  // First address becomes default automatically.
  const makeDefault = Boolean(input.setDefault) || count === 0;

  const created = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({
        where: { userId, isDefaultShipping: true },
        data: { isDefaultShipping: false },
      });
    }
    return tx.address.create({
      data: {
        userId,
        label: payload.label ?? null,
        contactName: payload.contactName,
        phone: payload.phone,
        line1: payload.line1,
        line2: payload.line2 ?? null,
        city: payload.city,
        state: payload.state,
        pincode: payload.pincode,
        country: payload.country ?? "India",
        isDefaultShipping: makeDefault,
      },
    });
  });

  return toDto(created);
}

export async function update(
  userId: string,
  id: string,
  input: UpdateAddressRequest,
): Promise<AddressDto> {
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Address not found");

  const country = normalizeCountry(input.country);
  const payload: AddressInput = { ...input, country };
  assertShape(payload);

  const promoteToDefault = Boolean(input.setDefault) && !existing.isDefaultShipping;

  const updated = await prisma.$transaction(async (tx) => {
    if (promoteToDefault) {
      await tx.address.updateMany({
        where: { userId, isDefaultShipping: true },
        data: { isDefaultShipping: false },
      });
    }
    return tx.address.update({
      where: { id },
      data: {
        label: payload.label ?? null,
        contactName: payload.contactName,
        phone: payload.phone,
        line1: payload.line1,
        line2: payload.line2 ?? null,
        city: payload.city,
        state: payload.state,
        pincode: payload.pincode,
        country: payload.country ?? "India",
        ...(promoteToDefault ? { isDefaultShipping: true } : {}),
      },
    });
  });

  return toDto(updated);
}

export async function remove(userId: string, id: string): Promise<void> {
  const existing = await prisma.address.findFirst({
    where: { id, userId },
    select: { id: true, isDefaultShipping: true },
  });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Address not found");

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });
    if (existing.isDefaultShipping) {
      // Promote most recent remaining row to default so picker always has one.
      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (next) {
        await tx.address.update({
          where: { id: next.id },
          data: { isDefaultShipping: true },
        });
      }
    }
  });
}

export async function setDefault(userId: string, id: string): Promise<AddressDto> {
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) throw new HttpError(404, "NOT_FOUND", "Address not found");

  const updated = await prisma.$transaction(async (tx) => {
    await tx.address.updateMany({
      where: { userId, isDefaultShipping: true },
      data: { isDefaultShipping: false },
    });
    return tx.address.update({
      where: { id },
      data: { isDefaultShipping: true },
    });
  });

  return toDto(updated);
}
