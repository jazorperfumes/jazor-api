import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/wishlistController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const wishlistRouter = Router();

wishlistRouter.use(requireAuth);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

wishlistRouter.get("/", asyncHandler(ctrl.list));
wishlistRouter.post("/", writeLimiter, asyncHandler(ctrl.add));
wishlistRouter.delete("/:productId", writeLimiter, asyncHandler(ctrl.remove));
