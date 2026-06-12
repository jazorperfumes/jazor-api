import { Router } from "express";
import * as ctrl from "../controllers/scentFinderController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const scentFinderRouter = Router();

scentFinderRouter.post("/match", asyncHandler(ctrl.match));
