import type { Request, Response } from "express";
import { z } from "zod";
import * as addressService from "../services/addressService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type {
  AddressDto,
  AddressListResponse,
  AddressMutationResponse,
} from "../types/address.js";

const addressBodySchema = z.object({
  label: z.string().trim().max(40).optional(),
  contactName: z.string().trim().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{10,15}$/, "Invalid phone"),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, "Invalid pincode"),
  country: z.string().trim().min(2).max(60).default("India"),
  setDefault: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().cuid() });

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function list(req: Request, res: Response) {
  const userId = requireUserId(req);
  const items = await addressService.list(userId);
  ok<AddressListResponse>(res, { items });
}

export async function create(req: Request, res: Response) {
  const userId = requireUserId(req);
  const body = addressBodySchema.parse(req.body ?? {});
  const address = await addressService.create(userId, body);
  ok<AddressMutationResponse>(res, { address }, 201);
}

export async function update(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = idParam.parse(req.params);
  const body = addressBodySchema.parse(req.body ?? {});
  const address = await addressService.update(userId, id, body);
  ok<AddressMutationResponse>(res, { address });
}

export async function remove(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = idParam.parse(req.params);
  await addressService.remove(userId, id);
  ok(res, { id });
}

export async function setDefault(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = idParam.parse(req.params);
  const address: AddressDto = await addressService.setDefault(userId, id);
  ok<AddressMutationResponse>(res, { address });
}
