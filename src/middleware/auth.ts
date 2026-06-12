import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "./error.js";

export interface JwtPayload {
  sub: string;
  email: string;
}

const AUTH_COOKIE = "jazor_session";

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  const header = req.headers.authorization;
  const headerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
  const token = cookieToken || headerToken;
  if (!token) {
    return next(new HttpError(401, "UNAUTHENTICATED", "Authentication required"));
  }
  let payload: JwtPayload & { purpose?: string };
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload & { purpose?: string };
  } catch {
    return next(new HttpError(401, "TOKEN_INVALID", "Invalid or expired session"));
  }
  // Reject purpose-bearing tokens (e.g. verify-email) so they cannot be
  // replayed as session tokens against requireAuth-protected routes.
  if (payload.purpose) {
    return next(new HttpError(401, "TOKEN_INVALID", "Not a session token"));
  }
  if (!payload.sub || !payload.email) {
    return next(new HttpError(401, "TOKEN_INVALID", "Invalid session token"));
  }
  // Confirm the user row still exists. JWT cannot be revoked until a Session
  // table is added; this catches the common dev-time race where the DB was
  // reset but the browser still holds a stale cookie.
  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true },
    });
    if (!user) {
      return next(new HttpError(401, "TOKEN_INVALID", "Session user no longer exists"));
    }
  } catch (err) {
    return next(err);
  }
  req.user = { sub: payload.sub, email: payload.email };
  next();
}

export const AUTH_COOKIE_NAME = AUTH_COOKIE;