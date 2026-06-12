import { describe, expect, it, vi } from "vitest";
import { setSessionCookie, clearSessionCookie } from "../../src/utils/sessionCookie.js";
import { AUTH_COOKIE_NAME } from "../../src/middleware/auth.js";

function makeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as import("express").Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

describe("sessionCookie", () => {
  it("sets httpOnly, lax, path /, with maxAge parsed from 7d", () => {
    const res = makeRes();
    setSessionCookie(res, "abc.def.ghi");
    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [name, value, opts] = res.cookie.mock.calls[0];
    expect(name).toBe(AUTH_COOKIE_NAME);
    expect(value).toBe("abc.def.ghi");
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(opts.maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("clearSessionCookie matches set options", () => {
    const res = makeRes();
    clearSessionCookie(res);
    const [name, opts] = res.clearCookie.mock.calls[0];
    expect(name).toBe(AUTH_COOKIE_NAME);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});
