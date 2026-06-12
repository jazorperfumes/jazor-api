import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { makeAgent } from "../helpers/app.js";
import { makeUser } from "../helpers/factories.js";
import { prisma } from "../../src/lib/prisma.js";
import { env } from "../../src/env.js";
import { createHash } from "node:crypto";

describe("POST /api/auth/register", () => {
  it("creates user, returns 201 pending, does NOT set a session cookie", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "new@jazor.test", password: "Password123!", name: "New" });

    // No session until the emailed OTP is confirmed.
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.pending).toBe(true);
    expect(res.body.data.email).toBe("new@jazor.test");

    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith("jazor_session="))).toBe(false);
  });

  it("re-registering an unverified email re-issues OTP (201 pending, not 409)", async () => {
    await makeUser({ email: "pending@jazor.test", verified: false });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "pending@jazor.test", password: "Password123!" });
    expect(res.status).toBe(201);
    expect(res.body.data.pending).toBe(true);
  });

  it("409 on duplicate verified email", async () => {
    await makeUser({ email: "dup@jazor.test" });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "dup@jazor.test", password: "Password123!" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_EXISTS");
  });

  it("400 on invalid email", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "Password123!" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("400 on short password", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/register")
      .send({ email: "ok@jazor.test", password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("200 on valid creds, returns user dto", async () => {
    const u = await makeUser({ email: "login@jazor.test", password: "Password123!" });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/login")
      .send({ email: u.email, password: "Password123!" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(u.id);
  });

  it("401 on wrong password", async () => {
    await makeUser({ email: "wrong@jazor.test", password: "Password123!" });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/login")
      .send({ email: "wrong@jazor.test", password: "BadPass!" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  // NOTE: login distinguishes unknown email (404 ACCOUNT_NOT_FOUND) from a bad
  // password (401 INVALID_CREDENTIALS) — a deliberate UX choice that trades away
  // email-enumeration resistance. Revisit if that tradeoff is unacceptable.
  it("404 ACCOUNT_NOT_FOUND on unknown email", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/login")
      .send({ email: "ghost@jazor.test", password: "Whatever1!" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("403 EMAIL_NOT_VERIFIED for valid creds on an unverified account", async () => {
    const u = await makeUser({ email: "unverified@jazor.test", verified: false });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/login")
      .send({ email: u.email, password: u.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    // No session issued for an unverified login attempt.
    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith("jazor_session="))).toBe(false);
  });
});

describe("CSRF gate", () => {
  it("403 CSRF_INVALID when posting without x-csrf-token", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/login")
      .set("x-csrf-token", "")
      .send({ email: "x@jazor.test", password: "Password123!" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_INVALID");
  });
});

describe("GET /api/auth/me", () => {
  it("401 when no session", async () => {
    const agent = await makeAgent();
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("200 after login, returns current user", async () => {
    const u = await makeUser({ email: "me@jazor.test" });
    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: u.email, password: u.password });
    const res = await agent.get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(u.id);
  });

  it("401 with verify-email purpose token (replay block)", async () => {
    const u = await makeUser();
    const purposeToken = jwt.sign(
      { sub: u.id, email: u.email, purpose: "verify-email" },
      env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    const agent = await makeAgent();
    const res = await agent
      .get("/api/auth/me")
      .set("Cookie", `jazor_session=${purposeToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("TOKEN_INVALID");
  });

  it("401 when user deleted but token still valid", async () => {
    const u = await makeUser();
    const token = jwt.sign({ sub: u.id, email: u.email }, env.JWT_SECRET, { expiresIn: "1h" });
    await prisma.user.delete({ where: { id: u.id } });
    const agent = await makeAgent();
    const res = await agent.get("/api/auth/me").set("Cookie", `jazor_session=${token}`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears jazor_session cookie", async () => {
    const u = await makeUser();
    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: u.email, password: u.password });
    const res = await agent.post("/api/auth/logout").send({});
    expect(res.status).toBe(200);
    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    const sess = cookies.find((c) => c.startsWith("jazor_session="));
    expect(sess).toBeDefined();
    expect(sess).toMatch(/jazor_session=;/);
  });
});

describe("Password reset", () => {
  it("stores sha256-hashed token in DB (never raw)", async () => {
    const u = await makeUser();
    const agent = await makeAgent();
    const res = await agent.post("/api/auth/forgot-password").send({ email: u.email });
    expect(res.status).toBe(200);

    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.passwordResetTokenHash).toBeTruthy();
    expect(fresh?.passwordResetTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fresh?.passwordResetExpiresAt).toBeInstanceOf(Date);
  });

  it("forgot-password returns 200 even for unknown email (no enumeration)", async () => {
    const agent = await makeAgent();
    const res = await agent.post("/api/auth/forgot-password").send({ email: "nobody@jazor.test" });
    expect(res.status).toBe(200);
  });

  it("reset-password rejects bad token", async () => {
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/reset-password")
      .send({ token: "wrong", password: "Password123!" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOKEN_INVALID");
  });

  it("reset-password clears token after successful use (single-use)", async () => {
    const u = await makeUser();
    const rawToken = "a".repeat(64);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const agent = await makeAgent();
    const ok1 = await agent
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "NewPassword1!" });
    expect(ok1.status).toBe(200);

    const fresh = await prisma.user.findUnique({ where: { id: u.id } });
    expect(fresh?.passwordResetTokenHash).toBeNull();

    const reuse = await agent
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "OtherPass1!" });
    expect(reuse.status).toBe(400);
  });

  it("reset-password rejects expired token", async () => {
    const u = await makeUser();
    const rawToken = "b".repeat(64);
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: u.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() - 1000),
      },
    });
    const agent = await makeAgent();
    const res = await agent
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "OtherPass1!" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TOKEN_EXPIRED");
  });
});

describe("Email verification (OTP)", () => {
  // Seed a known OTP directly (the real code is only ever emailed, never returned).
  async function seedOtp(userId: string, code: string, expiresAt: Date) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        emailOtpHash: createHash("sha256").update(code).digest("hex"),
        emailOtpExpiresAt: expiresAt,
        emailOtpAttempts: 0,
      },
    });
  }

  it("verify-otp accepts the correct code, sets emailVerifiedAt + issues session", async () => {
    const u = await makeUser({ verified: false });
    await seedOtp(u.id, "123456", new Date(Date.now() + 600_000));

    const agent = await makeAgent();
    const res = await agent.post("/api/auth/verify-otp").send({ email: u.email, code: "123456" });
    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerifiedAt).toBeTruthy();

    const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
    expect(cookies.some((c) => c.startsWith("jazor_session="))).toBe(true);
  });

  it("verify-otp rejects a wrong code with OTP_INVALID", async () => {
    const u = await makeUser({ verified: false });
    await seedOtp(u.id, "123456", new Date(Date.now() + 600_000));

    const agent = await makeAgent();
    const res = await agent.post("/api/auth/verify-otp").send({ email: u.email, code: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_INVALID");
  });

  it("verify-otp rejects an expired code with OTP_EXPIRED", async () => {
    const u = await makeUser({ verified: false });
    await seedOtp(u.id, "123456", new Date(Date.now() - 1000));

    const agent = await makeAgent();
    const res = await agent.post("/api/auth/verify-otp").send({ email: u.email, code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });

  it("resend-otp returns 200 for an unknown email (no enumeration)", async () => {
    const agent = await makeAgent();
    const res = await agent.post("/api/auth/resend-otp").send({ email: "nobody@jazor.test" });
    expect(res.status).toBe(200);
  });
});

describe("requireAdmin gate", () => {
  it("403 FORBIDDEN for CUSTOMER hitting /api/admin/dashboard", async () => {
    const u = await makeUser({ role: "CUSTOMER" });
    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: u.email, password: u.password });
    const res = await agent.get("/api/admin/dashboard");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("200 for ADMIN", async () => {
    const u = await makeUser({ role: "ADMIN" });
    const agent = await makeAgent();
    await agent.post("/api/auth/login").send({ email: u.email, password: u.password });
    const res = await agent.get("/api/admin/dashboard");
    expect(res.status).toBe(200);
  });

  it("401 UNAUTHENTICATED when no session at all", async () => {
    const agent = await makeAgent();
    const res = await agent.get("/api/admin/dashboard");
    expect(res.status).toBe(401);
  });
});
