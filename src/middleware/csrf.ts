import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { env } from "../env.js";
import { HttpError } from "./error.js";

export const CSRF_COOKIE = "jazor_csrf";
export const CSRF_HEADER = "x-csrf-token";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cookieOpts() {
  const isProd = env.NODE_ENV === "production";
  return {
    httpOnly: false, // UI must read this to echo in header
    sameSite: (isProd ? "none" : "lax") as "none" | "lax",
    secure: isProd,
    path: "/",
    maxAge: 60 * 60 * 24 * 7 * 1000,
  };
}

/** Ensure a csrf cookie exists for the session. Always issue if missing. */
export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = randomBytes(32).toString("hex");
    res.cookie(CSRF_COOKIE, token, cookieOpts());
    req.cookies = { ...(req.cookies ?? {}), [CSRF_COOKIE]: token };
  }
  next();
}

/** Issue a fresh token (call on login/register to rotate after auth state change). */
export function rotateCsrf(res: Response): string {
  const token = randomBytes(32).toString("hex");
  res.cookie(CSRF_COOKIE, token, cookieOpts());
  return token;
}

/** Double-submit cookie check on unsafe methods. */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.header(CSRF_HEADER);
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(new HttpError(403, "CSRF_INVALID", "CSRF token missing or invalid"));
  }
  next();
}
