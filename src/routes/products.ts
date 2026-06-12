import { Router } from "express";
import * as ctrl from "../controllers/productsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";

export const productsRouter = Router();

productsRouter.get("/", asyncHandler(ctrl.list));
productsRouter.get("/:slug", asyncHandler(ctrl.detail));
productsRouter.get("/:slug/reviews", asyncHandler(ctrl.reviews));
productsRouter.get("/:slug/related", asyncHandler(ctrl.related));
