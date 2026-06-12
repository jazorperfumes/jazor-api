import type { Request, Response } from "express";
import { z } from "zod";
import * as checkoutService from "../services/checkoutService.js";
import { ok } from "../utils/respond.js";
import { HttpError } from "../middleware/error.js";
import type { QuoteResponse } from "../types/checkout.js";

const quoteSchema = z.object({
  discountCodes: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  giftSelections: z
    .array(z.object({ promotionId: z.string().min(1), variantId: z.string().min(1) }))
    .max(20)
    .optional(),
  giftWrap: z.boolean().optional(),
  // Indian PIN. Currently unused by shipping calc — reserved for zone-based rates.
  pincode: z.string().regex(/^[0-9]{6}$/, "Invalid pincode").optional(),
});

function requireUserId(req: Request): string {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  return req.user.sub;
}

export async function quote(req: Request, res: Response) {
  const userId = requireUserId(req);
  const body = quoteSchema.parse(req.body ?? {});
  const data = await checkoutService.quote(userId, body);
  ok<QuoteResponse>(res, data);
}
