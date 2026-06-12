import type { Request, Response } from "express";
import { z } from "zod";
import * as svc from "../services/reviewsService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { ReviewMutationResponse } from "../types/reviews.js";

const createSchema = z.object({
  orderItemId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10).max(2000),
});

const idParam = z.object({ id: z.string().min(1) });

function userId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function create(req: Request, res: Response) {
  const body = createSchema.parse(req.body);
  const review = await svc.create(userId(req), body);
  ok<ReviewMutationResponse>(res, { review }, 201);
}

export async function remove(req: Request, res: Response) {
  const { id } = idParam.parse(req.params);
  await svc.remove(userId(req), id);
  ok<{ id: string }>(res, { id });
}
