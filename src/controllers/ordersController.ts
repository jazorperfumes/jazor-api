import type { Request, Response } from "express";
import { z } from "zod";
import * as ordersService from "../services/ordersService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { CreateOrderResponse, OrderDetailDto } from "../types/orders.js";

const addressSchema = z.object({
  label: z.string().trim().max(40).optional(),
  contactName: z.string().trim().min(1).max(120),
  phone: z.string().regex(/^\+?[0-9]{10,15}$/, "Invalid phone"),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, "Invalid pincode"),
  country: z.string().trim().min(2).max(60).default("India"),
});

const createSchema = z
  .object({
    shippingAddressId: z.string().cuid().optional(),
    shippingAddress: addressSchema.optional(),
    saveAddress: z.boolean().optional(),
    setDefaultAddress: z.boolean().optional(),
    giftWrap: z.boolean().default(false),
    giftMessage: z.string().trim().max(500).optional(),
    discountCodes: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    giftSelections: z
      .array(z.object({ promotionId: z.string().min(1), variantId: z.string().min(1) }))
      .max(20)
      .optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((d) => d.shippingAddressId || d.shippingAddress, {
    message: "Shipping address required",
    path: ["shippingAddress"],
  });

const idParam = z.object({ id: z.string().min(1) });

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function create(req: Request, res: Response) {
  const userId = requireUserId(req);
  const body = createSchema.parse(req.body ?? {});
  const data = await ordersService.create(userId, body);
  ok<CreateOrderResponse>(res, data, 201);
}

export async function get(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = idParam.parse(req.params);
  const data = await ordersService.get(id, userId);
  ok<OrderDetailDto>(res, data);
}
