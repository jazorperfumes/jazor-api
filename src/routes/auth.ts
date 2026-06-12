import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/authController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const passwordRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// Resending a code triggers an email each time — keep it tight.
const resendOtpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 4,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

authRouter.post("/register", loginLimiter, asyncHandler(ctrl.register));
authRouter.post("/login", loginLimiter, asyncHandler(ctrl.login));
authRouter.post("/logout", asyncHandler(ctrl.logout));
authRouter.get("/me", requireAuth, asyncHandler(ctrl.me));

authRouter.post("/forgot-password", passwordRecoveryLimiter, asyncHandler(ctrl.forgotPassword));
authRouter.post("/reset-password", passwordRecoveryLimiter, asyncHandler(ctrl.resetPassword));

// Unauthenticated — the user has no session until the OTP is confirmed.
authRouter.post("/verify-otp", verifyLimiter, asyncHandler(ctrl.verifyOtp));
authRouter.post("/resend-otp", resendOtpLimiter, asyncHandler(ctrl.resendOtp));
