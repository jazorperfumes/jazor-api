import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/ordersController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

// Throttle order creation so abandoned-payment loops can't flood the table.
const createLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

ordersRouter.post("/", createLimiter, asyncHandler(ctrl.create));
ordersRouter.get("/:id", asyncHandler(ctrl.get));
