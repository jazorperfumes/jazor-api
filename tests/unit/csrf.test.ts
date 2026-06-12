import { describe, expect, it, vi } from "vitest";
import { requireCsrf, ensureCsrfCookie, CSRF_COOKIE, CSRF_HEADER } from "../../src/middleware/csrf.js";
import { HttpError } from "../../src/middleware/error.js";

type NextFn = (err?: unknown) => void;

function makeReq(method: string, cookieToken?: string, headerToken?: string) {
  return {
    method,
    cookies: cookieToken ? { [CSRF_COOKIE]: cookieToken } : {},
    header(name: string) {
      if (name.toLowerCase() === CSRF_HEADER) return headerToken;
      return undefined;
    },
  } as unknown as import("express").Request;
}

function makeRes() {
  return { cookie: vi.fn() } as unknown as import("express").Response;
}

describe("requireCsrf", () => {
  it("skips safe methods", () => {
    const next = vi.fn();
    requireCsrf(makeReq("GET"), makeRes(), next as NextFn);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects mismatched token on POST", () => {
    const next = vi.fn();
    requireCsrf(makeReq("POST", "a", "b"), makeRes(), next as NextFn);
    const err = next.mock.calls[0][0] as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("CSRF_INVALID");
  });

  it("rejects missing header on POST", () => {
    const next = vi.fn();
    requireCsrf(makeReq("POST", "a", undefined), makeRes(), next as NextFn);
    expect((next.mock.calls[0][0] as HttpError).code).toBe("CSRF_INVALID");
  });

  it("passes when cookie === header", () => {
    const next = vi.fn();
    requireCsrf(makeReq("POST", "same", "same"), makeRes(), next as NextFn);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("ensureCsrfCookie", () => {
  it("sets cookie when absent and copies token into req.cookies", () => {
    const req = makeReq("GET") as unknown as { cookies: Record<string, string> };
    const res = makeRes();
    const next = vi.fn();
    ensureCsrfCookie(req as unknown as import("express").Request, res, next as NextFn);
    expect((res.cookie as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(CSRF_COOKIE);
    expect(req.cookies[CSRF_COOKIE]).toBeTruthy();
    expect(next).toHaveBeenCalled();
  });

  it("does not reissue when cookie already present", () => {
    const res = makeRes();
    const next = vi.fn();
    ensureCsrfCookie(makeReq("GET", "existing-token"), res, next as NextFn);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
