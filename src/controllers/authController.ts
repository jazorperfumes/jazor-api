import type { Request, Response } from "express";
import { z } from "zod";
import * as authService from "../services/authService.js";
import { HttpError } from "../middleware/error.js";
import { ok } from "../utils/respond.js";
import { setSessionCookie, clearSessionCookie } from "../utils/sessionCookie.js";
import { rotateCsrf } from "../middleware/csrf.js";
import type {
  AuthResponse,
  MeResponse,
  OkResponse,
  RegisterResponse,
  VerifyOtpResponse,
} from "../types/auth.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
});

const resendOtpSchema = z.object({
  email: z.string().email(),
});

export async function register(req: Request, res: Response) {
  const body = registerSchema.parse(req.body);
  const { email } = await authService.register(body);
  // No session yet — the user must verify the emailed OTP first.
  ok<RegisterResponse>(res, { pending: true, email }, 201);
}

export async function login(req: Request, res: Response) {
  const body = loginSchema.parse(req.body);
  const { user, token } = await authService.login(body);
  setSessionCookie(res, token);
  rotateCsrf(res);
  ok<AuthResponse>(res, { user });
}

export async function me(req: Request, res: Response) {
  if (!req.user) throw new HttpError(401, "UNAUTHENTICATED", "Authentication required");
  const user = await authService.getCurrentUser(req.user.sub);
  ok<MeResponse>(res, { user });
}

export async function logout(_req: Request, res: Response) {
  clearSessionCookie(res);
  ok<OkResponse>(res, { ok: true });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = forgotPasswordSchema.parse(req.body);
  await authService.requestPasswordReset(email);
  ok<OkResponse>(res, { ok: true });
}

export async function resetPassword(req: Request, res: Response) {
  const body = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(body);
  ok<OkResponse>(res, { ok: true });
}

export async function verifyOtp(req: Request, res: Response) {
  const body = verifyOtpSchema.parse(req.body);
  const { user, token } = await authService.verifyEmailOtp(body);
  // OTP confirmed — issue the session now.
  setSessionCookie(res, token);
  rotateCsrf(res);
  ok<VerifyOtpResponse>(res, { user });
}

export async function resendOtp(req: Request, res: Response) {
  const { email } = resendOtpSchema.parse(req.body);
  await authService.resendEmailOtp(email);
  ok<OkResponse>(res, { ok: true });
}
