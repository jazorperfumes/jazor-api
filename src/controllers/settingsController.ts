import type { Request, Response } from "express";
import * as settingsService from "../services/settingsService.js";
import { ok } from "../utils/respond.js";
import type { PublicSettingsDto } from "../types/settings.js";

export function getPublic(_req: Request, res: Response) {
  const data = settingsService.getPublic();
  ok<PublicSettingsDto>(res, data);
}
