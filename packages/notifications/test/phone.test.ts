import { describe, expect, it } from "vitest";
import { normalizePhone } from "../src/phone";

describe("normalizePhone", () => {
  it("normalizes a US national number to E.164", () => {
    expect(normalizePhone("(213) 373-4253", "US")).toBe("+12133734253");
  });
  it("passes through a valid E.164 number", () => {
    expect(normalizePhone("+442071838750", "US")).toBe("+442071838750");
  });
  it("returns null for junk", () => {
    expect(normalizePhone("not a phone", "US")).toBeNull();
  });
  it("returns null for empty", () => {
    expect(normalizePhone("", "US")).toBeNull();
  });
});
