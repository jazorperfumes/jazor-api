import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "../services/adminPickupAddressesService.js";
import { ok } from "../utils/respond.js";

const idParam = z.object({ id: z.string().min(1) });

const upsertSchema = z.object({
  label: z.string().min(1).max(80),
  contactName: z.string().min(1).max(120),
  phone: z.string().min(5).max(20),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable().optional(),
  city: z.string().min(1).max(80),
  state: z.string().min(1).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, "Indian pincode must be 6 digits"),
  country: z.string().max(80).optional(),
  providerPickupId: z.string().max(80).nullable().optional(),
  isDefault: z.boolean().optional(),
});

const patchSchema = upsertSchema.partial();

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function list(req: Request, res: Response) {
  const query = listQuerySchema.parse(req.query);
  ok(res, await svc.list(query));
}

export async function get(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await svc.detail(id));
}

export async function create(req: Request, res: Response) {
  const body = upsertSchema.parse(req.body);
  ok(res, await svc.create(body), 201);
}

export async function patch(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  const body = patchSchema.parse(req.body);
  ok(res, await svc.patch(id, body));
}

export async function remove(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  ok(res, await svc.remove(id));
}
