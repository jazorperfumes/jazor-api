import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "../services/wishlistService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { WishlistResponse } from "../types/wishlist.js";

const addSchema = z.object({ productId: z.string().min(1) });
const removeParam = z.object({ productId: z.string().min(1) });

function userId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function list(req: Request, res: Response) {
  const data = await svc.list(userId(req));
  ok<WishlistResponse>(res, data);
}

export async function add(req: Request, res: Response) {
  const body = addSchema.parse(req.body);
  const data = await svc.add(userId(req), body.productId);
  ok<WishlistResponse>(res, data, 201);
}

export async function remove(req: Request, res: Response) {
  const { productId } = removeParam.parse(req.params);
  const data = await svc.remove(userId(req), productId);
  ok<WishlistResponse>(res, data);
}
