import type { Response } from "express";
import { env } from "../env.js";
import { AUTH_COOKIE_NAME } from "../middleware/auth.js";

function parseExpiryMs(expiresIn: string): number {
  // Crude: supports "7d", "24h", "60m", "30s", or numeric ms.
  const m = expiresIn.match(/^(\d+)([dhms])?$/);
  if (!m) return 7 * 24 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  switch (m[2]) {
    case "d": return n * 24 * 60 * 60 * 1000;
    case "h": return n * 60 * 60 * 1000;
    case "m": return n * 60 * 1000;
    case "s": return n * 1000;
    default: return n;
  }
}

const isProd = () => env.NODE_ENV === "production";

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: isProd() ? "none" : "lax",
    secure: isProd(),
    path: "/",
    maxAge: parseExpiryMs(env.JWT_EXPIRES_IN),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: isProd() ? "none" : "lax",
    secure: isProd(),
    path: "/",
  });
}
