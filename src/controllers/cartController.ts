import type { Request, Response } from "express";
import { z } from "zod";
import * as cartService from "../services/cartService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { CartDto } from "../types/cart.js";

const MAX_CART_QTY = 10;

const addSchema = z.object({
  variantId: z.string().min(1),
  qty: z.coerce.number().int().min(1).max(MAX_CART_QTY).default(1),
});

const updateSchema = z.object({
  qty: z.coerce.number().int().min(1).max(MAX_CART_QTY),
});

const itemIdParam = z.object({ id: z.string().min(1) });

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function get(req: Request, res: Response) {
  const userId = requireUserId(req);
  const data = await cartService.getCart(userId);
  ok<CartDto>(res, data);
}

export async function addItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const body = addSchema.parse(req.body);
  const data = await cartService.addItem(userId, body.variantId, body.qty);
  ok<CartDto>(res, data, 201);
}

export async function updateItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = itemIdParam.parse(req.params);
  const body = updateSchema.parse(req.body);
  const data = await cartService.updateItemQty(userId, id, body.qty);
  ok<CartDto>(res, data);
}

export async function removeItem(req: Request, res: Response) {
  const userId = requireUserId(req);
  const { id } = itemIdParam.parse(req.params);
  const data = await cartService.removeItem(userId, id);
  ok<CartDto>(res, data);
}

export async function clear(req: Request, res: Response) {
  const userId = requireUserId(req);
  const data = await cartService.clearCart(userId);
  ok<CartDto>(res, data);
}
