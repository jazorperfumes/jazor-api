export type UserRole = "CUSTOMER" | "ADMIN";

export interface PublicUserDto {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  /** ISO timestamp or null */
  emailVerifiedAt: string | null;
  /** ISO timestamp */
  createdAt: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
}

export interface VerifyOtpRequest {
  email: string;
  code: string;
}

export interface ResendOtpRequest {
  email: string;
}

export interface AuthResponse {
  user: PublicUserDto;
}

/** Register no longer logs the user in — it returns a pending-verification marker. */
export interface RegisterResponse {
  pending: true;
  email: string;
}

export interface MeResponse {
  user: PublicUserDto;
}

export interface OkResponse {
  ok: true;
}

export interface VerifyOtpResponse {
  user: PublicUserDto;
}
