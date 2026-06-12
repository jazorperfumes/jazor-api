import { Router } from "express";
import * as ctrl from "../controllers/checkoutController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const checkoutRouter = Router();

checkoutRouter.use(requireAuth);

checkoutRouter.post("/quote", asyncHandler(ctrl.quote));
