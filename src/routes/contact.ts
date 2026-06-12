import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/contactController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const contactRouter = Router();

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

contactRouter.post("/", contactLimiter, asyncHandler(ctrl.create));