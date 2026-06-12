import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/refundClaimsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { refundClaimImagesUpload } from "../middleware/upload.js";

export const refundClaimsRouter = Router();

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

refundClaimsRouter.use(requireAuth);

refundClaimsRouter.post(
  "/",
  writeLimiter,
  refundClaimImagesUpload("images"),
  asyncHandler(ctrl.submit),
);
refundClaimsRouter.get("/:id", asyncHandler(ctrl.getOwn));
