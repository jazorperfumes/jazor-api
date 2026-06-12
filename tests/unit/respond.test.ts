import { describe, expect, it, vi } from "vitest";
import { ok } from "../../src/utils/respond.js";

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } & {
    [key: string]: unknown;
  };
}

describe("ok()", () => {
  it("wraps data in { ok: true, data } at 200 by default", () => {
    const res = makeRes();
    ok(res as never, { foo: 1 });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, data: { foo: 1 } });
  });

  it("uses provided status", () => {
    const res = makeRes();
    ok(res as never, { id: "x" }, 201);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
