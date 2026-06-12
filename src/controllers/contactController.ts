import type { Request, Response } from "express";
import { z } from "zod";
import * as contactService from "../services/contactService.js";
import { ok } from "../utils/respond.js";
import type { OkResponse } from "../types/auth.js";

const contactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  subject: z.string().max(200).optional(),
  message: z.string().min(10).max(2000),
});

export async function create(req: Request, res: Response) {
  const body = contactSchema.parse(req.body);
  await contactService.create(body);
  ok<OkResponse>(res, { ok: true });
}
