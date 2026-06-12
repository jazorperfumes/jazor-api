import { Router } from "express";
import * as ctrl from "../controllers/razorpayController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

/**
 * Note: `/api/razorpay/webhook` is mounted directly in app.ts with
 * `express.raw` BEFORE `express.json()` because the HMAC must verify against
 * the exact raw bytes Razorpay sent. The /verify route uses the regular JSON
 * body parser.
 */
export const razorpayRouter = Router();

razorpayRouter.post("/verify", requireAuth, asyncHandler(ctrl.verify));
