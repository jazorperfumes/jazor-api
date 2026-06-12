import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/reviewsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const reviewsRouter = Router();

reviewsRouter.use(requireAuth);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

reviewsRouter.post("/", writeLimiter, asyncHandler(ctrl.create));
reviewsRouter.delete("/:id", writeLimiter, asyncHandler(ctrl.remove));
