import type { Request, Response } from "express";
import { z } from "zod";
import * as newsletterService from "../services/newsletterService.js";
import { ok } from "../utils/respond.js";
import type { OkResponse } from "../types/auth.js";

const subscribeSchema = z.object({ email: z.string().email() });

export async function subscribe(req: Request, res: Response) {
  const { email } = subscribeSchema.parse(req.body);
  await newsletterService.subscribe(email);
  ok<OkResponse>(res, { ok: true });
}
