import type { Response } from "express";
import type { ApiResponse } from "../types/api.js";

export function ok<T>(res: Response, data: T, status = 200): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return res.status(status).json(body);
}
