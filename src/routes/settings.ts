import { Router } from "express";
import * as ctrl from "../controllers/settingsController.js";

export const settingsRouter = Router();

settingsRouter.get("/public", ctrl.getPublic);
