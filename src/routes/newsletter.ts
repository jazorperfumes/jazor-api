import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/newsletterController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const newsletterRouter = Router();

const newsletterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

newsletterRouter.post("/", newsletterLimiter, asyncHandler(ctrl.subscribe));
