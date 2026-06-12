import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/addressController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const addressesRouter = Router();

addressesRouter.use(requireAuth);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

addressesRouter.get("/", asyncHandler(ctrl.list));
addressesRouter.post("/", writeLimiter, asyncHandler(ctrl.create));
addressesRouter.put("/:id", writeLimiter, asyncHandler(ctrl.update));
addressesRouter.delete("/:id", writeLimiter, asyncHandler(ctrl.remove));
addressesRouter.post("/:id/default", writeLimiter, asyncHandler(ctrl.setDefault));
