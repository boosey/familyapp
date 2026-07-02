/**
 * kindredClerkAppearance is a PLAIN, serializable theme object: no functions, no @clerk import
 * (so it stays safe to import from the mock build), and it flattens Clerk's own card so the
 * widget nests inside the AuthScreen shell.
 */
import { describe, expect, it } from "vitest";
import { kindredClerkAppearance } from "../lib/clerk-appearance";

describe("kindredClerkAppearance", () => {
  it("is a plain serializable theme object (no functions / no component refs)", () => {
    expect(() => JSON.parse(JSON.stringify(kindredClerkAppearance))).not.toThrow();
    expect(kindredClerkAppearance.variables.colorPrimary).toBe("var(--accent)");
  });

  it("flattens Clerk's own card so it nests inside the AuthScreen shell", () => {
    expect(kindredClerkAppearance.elements.card).toMatchObject({
      boxShadow: "none",
      border: "none",
      background: "transparent",
    });
  });
});
