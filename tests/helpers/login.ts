import jwt from "jsonwebtoken";
import { env } from "../../src/env.js";

/**
 * Sign a session token directly for tests that don't want to exercise the
 * login route (faster, deterministic). Mirrors authService.signAuthToken.
 */
export function signSessionToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}
