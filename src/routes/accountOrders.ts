import { Router } from "express";
import rateLimit from "express-rate-limit";
import * as ctrl from "../controllers/accountOrdersController.js";
import * as claimCtrl from "../controllers/refundClaimsController.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const accountOrdersRouter = Router();

accountOrdersRouter.use(requireAuth);

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

accountOrdersRouter.get("/", asyncHandler(ctrl.list));
accountOrdersRouter.get("/:id", asyncHandler(ctrl.get));
accountOrdersRouter.get("/:id/invoice", asyncHandler(ctrl.invoice));
accountOrdersRouter.post("/:id/cancel", writeLimiter, asyncHandler(ctrl.cancel));
accountOrdersRouter.get("/:id/refund-claims", asyncHandler(claimCtrl.listForOrder));
accountOrdersRouter.get("/:id/refund-claims/eligible", asyncHandler(claimCtrl.eligibleItems));
