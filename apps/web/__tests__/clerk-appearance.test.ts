/**
 * kindredClerkAppearance is a PLAIN, serializable theme object: no functions, no @clerk import
 * (so it stays safe to import from the mock build). Its `variables` carry the Kindred palette;
 * its `elements` carry only structural hides — the token-based VISUAL styling of Clerk's controls
 * lives in app/globals.css because Clerk resets CSS custom properties on those controls (a
 * `var(--token)` placed on a control resolves to empty and silently falls back to Clerk defaults).
 */
import { describe, expect, it } from "vitest";
import { kindredClerkAppearance } from "../lib/clerk-appearance";

/** Recursively collect every string leaf value under an object. */
function stringValues(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  if (obj && typeof obj === "object") return Object.values(obj).flatMap(stringValues);
  return [];
}

describe("kindredClerkAppearance", () => {
  it("is a plain serializable theme object (no functions / no component refs)", () => {
    expect(() => JSON.parse(JSON.stringify(kindredClerkAppearance))).not.toThrow();
    expect(kindredClerkAppearance.variables.colorPrimary).toBe("var(--accent)");
  });

  it("hides Clerk's duplicate header (AuthScreen renders its own title/subtitle)", () => {
    expect(kindredClerkAppearance.elements.headerTitle).toMatchObject({ display: "none" });
    expect(kindredClerkAppearance.elements.headerSubtitle).toMatchObject({ display: "none" });
  });

  // Regression: Clerk RESETS CSS custom properties on its form-control elements, so any
  // `var(--token)` used inside `elements` resolves to empty ON the control and the control paints
  // with Clerk's defaults (the bug that left the primary button transparent). Control theming that
  // needs tokens must live in app/globals.css (which re-asserts them via `inherit`), never here.
  it("uses no CSS custom properties in `elements` (Clerk clears them on controls)", () => {
    const offenders = stringValues(kindredClerkAppearance.elements).filter((v) =>
      v.includes("var(--"),
    );
    expect(offenders).toEqual([]);
  });
});
