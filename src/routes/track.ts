import { Router } from "express";
import * as ctrl from "../controllers/trackController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const trackRouter = Router();

trackRouter.get("/:orderNumber", asyncHandler(ctrl.get));
