import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/promotionsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const promotionsRouter = Router();

const bannerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Public, unauthenticated — the banner shows on every page incl. logged-out.
promotionsRouter.get("/banner", bannerLimiter, asyncHandler(ctrl.banner));
