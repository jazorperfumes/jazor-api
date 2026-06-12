import type { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "./error.js";

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(new HttpError(401, "UNAUTHENTICATED", "Authentication required"));
  }
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { role: true },
    });
    if (u?.role !== "ADMIN") {
      return next(new HttpError(403, "FORBIDDEN", "Admin only"));
    }
    next();
  } catch (err) {
    next(err);
  }
}
