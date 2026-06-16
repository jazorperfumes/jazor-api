import { randomBytes, randomInt, createHash } from "crypto";
import bcrypt from "bcryptjs";
import jwt, { JwtPayload, type SignOptions } from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";
import { logger } from "../lib/logger.js";
import { sendMail, passwordResetEmail, verifyOtpEmail } from "./mailService.js";
import type { PublicUserDto } from "../types/auth.js";

const RESET_TTL_MS = 60 * 60 * 1000; // 1h
const OTP_TTL_MS = 10 * 60 * 1000; // 10m
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000; // 1m — throttle re-sends so login/resend can't spam an inbox

/**
 * True if an OTP was issued within the cooldown window. `emailOtpExpiresAt`
 * encodes the send time (issuedAt = expiresAt − OTP_TTL_MS); no extra column.
 */
function otpRecentlySent(expiresAt: Date | null): boolean {
  if (!expiresAt) return false;
  const issuedAt = expiresAt.getTime() - OTP_TTL_MS;
  return Date.now() - issuedAt < OTP_RESEND_COOLDOWN_MS;
}

function signAuthToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 6-digit numeric OTP, zero-padded. Uses crypto.randomInt (uniform). */
function genOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Generate + persist a fresh OTP for the user and email it.
 * Resets the attempt counter. Awaited — a mail failure must surface to the caller.
 */
async function issueEmailOtp(userId: string, email: string, name: string | null): Promise<void> {
  const code = genOtp();
  await prisma.user.update({
    where: { id: userId },
    data: {
      emailOtpHash: hashToken(code),
      emailOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      emailOtpAttempts: 0,
    },
  });
  const msg = verifyOtpEmail(name, code);
  await sendMail({ to: email, ...msg });
}

export function toPublicUserDto(u: {
  id: string;
  email: string;
  name: string | null;
  role: "CUSTOMER" | "ADMIN";
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): PublicUserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Create the account but DO NOT issue a session. The user stays unverified
 * until they submit the emailed OTP via `verifyEmailOtp`. If the email is
 * already taken but never verified, re-issue a fresh OTP instead of 409 so a
 * user who abandoned signup can resume. The OTP mail is awaited — a send
 * failure rolls the whole call into an error so we don't strand the user.
 */
export async function register(input: { email: string; password: string; name?: string }): Promise<{ email: string }> {
  const email = input.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, emailVerifiedAt: true, emailOtpExpiresAt: true },
  });

  if (existing) {
    if (existing.emailVerifiedAt) {
      throw new HttpError(409, "EMAIL_EXISTS", "Email already registered");
    }
    // Unverified re-signup: refresh password + name, re-send OTP (throttled so
    // repeat signups on the same email can't bomb the inbox; the prior code
    // stays valid for its TTL).
    const passwordHash = await bcrypt.hash(input.password, 10);
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, name: input.name ?? existing.name ?? null },
    });
    if (!otpRecentlySent(existing.emailOtpExpiresAt)) {
      await issueEmailOtp(existing.id, email, input.name ?? existing.name ?? null);
    }
    return { email };
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, name: input.name ?? null },
    select: { id: true, email: true, name: true },
  });

  await issueEmailOtp(user.id, user.email, user.name);
  return { email };
}

export async function login(input: { email: string; password: string }): Promise<{ user: PublicUserDto; token: string }> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email }, select: {
      id: true,
      email: true,
      passwordHash: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      emailOtpExpiresAt: true,
      createdAt: true
    }
  });
  if (!user) throw new HttpError(404, "ACCOUNT_NOT_FOUND", "Looks like you don't have an account. Please sign up to continue.");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid credentials");

  // Mandatory verification: unverified accounts can't get a session. Re-send an
  // OTP (throttled) and bounce the caller to the verify screen.
  if (!user.emailVerifiedAt) {
    if (!otpRecentlySent(user.emailOtpExpiresAt)) {
      await issueEmailOtp(user.id, user.email, user.name);
    }
    throw new HttpError(403, "EMAIL_NOT_VERIFIED", "Please verify your email to continue");
  }

  const token = signAuthToken({ sub: user.id, email: user.email });
  return { user: toPublicUserDto(user), token };
}

export async function getCurrentUser(userId: string): Promise<PublicUserDto> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true
    }
  });
  if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  return toPublicUserDto(user);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true },
  });
  // Always return success to avoid email enumeration; only send if user exists.
  if (!user) return;

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: tokenHash, passwordResetExpiresAt: expiresAt },
  });

  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
  const msg = passwordResetEmail(user.name, link);
  await sendMail({ to: user.email, ...msg });
}

export async function resetPassword(input: { token: string; password: string }) {
  const tokenHash = hashToken(input.token);
  const user = await prisma.user.findUnique({
    where: { passwordResetTokenHash: tokenHash },
    select: { id: true, passwordResetExpiresAt: true },
  });
  if (!user || !user.passwordResetExpiresAt) {
    throw new HttpError(400, "TOKEN_INVALID", "Invalid or expired token");
  }
  if (user.passwordResetExpiresAt < new Date()) {
    throw new HttpError(400, "TOKEN_EXPIRED", "Token expired");
  }

  const passwordHash = await bcrypt.hash(input.password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    },
  });
}

/**
 * Validate the emailed OTP. On success: mark verified, clear OTP state, and
 * issue a session token (this is the real "login" moment for a new account).
 */
export async function verifyEmailOtp(input: { email: string; code: string }): Promise<{ user: PublicUserDto; token: string }> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      emailOtpHash: true,
      emailOtpExpiresAt: true,
      emailOtpAttempts: true,
    },
  });
  // Don't leak which emails exist — same generic failure as a bad code.
  if (!user) throw new HttpError(400, "OTP_INVALID", "Invalid or expired code");
  if (user.emailVerifiedAt) {
    throw new HttpError(400, "EMAIL_ALREADY_VERIFIED", "Email already verified");
  }
  if (!user.emailOtpHash || !user.emailOtpExpiresAt || user.emailOtpExpiresAt < new Date()) {
    throw new HttpError(400, "OTP_EXPIRED", "Code expired — request a new one");
  }
  if (user.emailOtpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, "OTP_TOO_MANY_ATTEMPTS", "Too many attempts — request a new code");
  }
  if (hashToken(input.code) !== user.emailOtpHash) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailOtpAttempts: { increment: 1 } },
    });
    throw new HttpError(400, "OTP_INVALID", "Invalid or expired code");
  }

  const verified = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailOtpHash: null,
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
    },
  });

  const token = signAuthToken({ sub: verified.id, email: verified.email });
  return { user: toPublicUserDto(verified), token };
}

/**
 * Re-send the OTP for an unverified account. Silent (no error) when the email
 * is unknown or already verified — anti-enumeration, mirrors password reset.
 */
export async function resendEmailOtp(email: string): Promise<void> {
  const normalized = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, emailOtpExpiresAt: true },
  });
  if (!user || user.emailVerifiedAt) return;
  // Throttle — ignore rapid repeat requests so an attacker can't bomb the inbox.
  if (otpRecentlySent(user.emailOtpExpiresAt)) return;
  try {
    await issueEmailOtp(user.id, user.email, user.name);
  } catch (e) {
    logger.error("resend otp mail failed", e, { userId: user.id });
  }
}
