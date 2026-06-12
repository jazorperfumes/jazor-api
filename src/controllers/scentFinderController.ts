import type { Request, Response } from "express";
import { z } from "zod";
import * as scentFinderService from "../services/scentFinderService.js";
import { ok } from "../utils/respond.js";
import type { ScentFinderMatchResponse } from "../types/scentFinder.js";

const matchSchema = z.object({
  mood: z.enum(["CONFIDENT", "CALM", "MYSTERIOUS", "FRESH"]),
  occasion: z.enum(["DAY", "EVENING", "SPECIAL", "DAILY"]),
  family: z.enum(["FLORAL", "WOODY", "ORIENTAL", "FRESH", "OUD", "AMBER", "CITRUS", "AQUATIC", "GOURMAND"]),
  collection: z.enum(["FRENCH", "ARABIC"]).optional(),
});

export async function match(req: Request, res: Response) {
  const body = matchSchema.parse(req.body);
  const data = await scentFinderService.match(body);
  ok<ScentFinderMatchResponse>(res, data);
}
