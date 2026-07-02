import type { ErrorRequestHandler, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import type { ApiErrorCode, ApiResponse } from "../types/api.js";
import { logger } from "../lib/logger.js";

export class HttpError extends Error {
  status: number;
  code: ApiErrorCode;
  details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (req: Request, _res: Response, next: NextFunction) => {
  next(new HttpError(404, "NOT_FOUND", `Not found: ${req.method} ${req.path}`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: err.flatten(),
      },
    };
    res.status(400).json(body);
    return;
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error(`API Error: ${err.code}`, err, { path: req.path, method: req.method });
    } else {
      logger.warn(`API Error: ${err.code}`, { message: err.message, path: req.path, method: req.method });
    }
    const body: ApiResponse<never> = {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }
  logger.error("Unhandled error", err, { path: req.path, method: req.method });
  const body: ApiResponse<never> = {
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  };
  res.status(500).json(body);
};
