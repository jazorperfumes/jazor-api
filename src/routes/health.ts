import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  ok(res, { status: "ok", uptime: process.uptime() });
});

healthRouter.get(
  "/db",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    ok(res, { status: "ok", db: "connected" });
  }),
);
