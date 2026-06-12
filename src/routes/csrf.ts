import { Router } from "express";
import { ok } from "../utils/respond.js";
import { CSRF_COOKIE } from "../middleware/csrf.js";

export const csrfRouter = Router();

csrfRouter.get("/", (req, res) => {
  ok(res, { csrfToken: req.cookies?.[CSRF_COOKIE] ?? null });
});
