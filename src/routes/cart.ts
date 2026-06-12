import { Router } from "express";
import * as ctrl from "../controllers/cartController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const cartRouter = Router();

cartRouter.use(requireAuth);

cartRouter.get("/", asyncHandler(ctrl.get));
cartRouter.post("/items", asyncHandler(ctrl.addItem));
cartRouter.patch("/items/:id", asyncHandler(ctrl.updateItem));
cartRouter.delete("/items/:id", asyncHandler(ctrl.removeItem));
cartRouter.delete("/", asyncHandler(ctrl.clear));
