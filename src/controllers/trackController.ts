import type { Request, Response } from "express";
import { z } from "zod";
import * as trackService from "../services/trackService.js";
import { ok } from "../utils/respond.js";
import type { TrackOrderDto } from "../types/track.js";

const paramSchema = z.object({ orderNumber: z.string().min(1).max(40) });
const querySchema = z.object({ email: z.string().email() });

export async function get(req: Request, res: Response) {
  const { orderNumber } = paramSchema.parse(req.params);
  const { email } = querySchema.parse(req.query);
  const data = await trackService.get(orderNumber, email);
  ok<TrackOrderDto>(res, data);
}
