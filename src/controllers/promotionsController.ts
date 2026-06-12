import type { Request, Response } from "express";
import * as promotionsService from "../services/promotionsService.js";
import { ok } from "../utils/respond.js";
import type { BannerResponse } from "../types/promotion.js";

/** Public — drives the site-wide seasonal banner + countdown. No auth. */
export async function banner(_req: Request, res: Response) {
  const banners = await promotionsService.activeBanners();
  ok<BannerResponse>(res, { banners });
}
