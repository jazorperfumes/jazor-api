import { describe, expect, it } from "vitest";
import { normalizeCountry } from "../../src/utils/country.js";
import { HttpError } from "../../src/middleware/error.js";

describe("normalizeCountry", () => {
  it("accepts alpha-2 IN", () => {
    expect(normalizeCountry("IN")).toBe("India");
  });

  it("accepts alpha-3 IND", () => {
    expect(normalizeCountry("IND")).toBe("India");
  });

  it("accepts mixed-case name", () => {
    expect(normalizeCountry("india")).toBe("India");
    expect(normalizeCountry("INDIA")).toBe("India");
  });

  it("rejects empty input with ADDRESS_INVALID", () => {
    expect(() => normalizeCountry("")).toThrow(HttpError);
    try {
      normalizeCountry("");
    } catch (e) {
      expect((e as HttpError).code).toBe("ADDRESS_INVALID");
    }
  });

  it("rejects unknown country with ADDRESS_INVALID", () => {
    expect(() => normalizeCountry("Atlantis")).toThrow(HttpError);
  });

  it("rejects unsupported country (currently India-only)", () => {
    try {
      normalizeCountry("US");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as HttpError).code).toBe("ADDRESS_INVALID");
      expect((e as HttpError).message).toMatch(/India/);
    }
  });
});
