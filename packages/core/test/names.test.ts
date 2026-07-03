/**
 * Tests for the shared spoken-name rule. This behavior was extracted verbatim from accounts.ts so
 * that account sign-up and onboarding derive `spokenName` identically; these lock the rule in place
 * after the move.
 */
import { describe, expect, it } from "vitest";
import { defaultSpokenName } from "../src/names";

describe("defaultSpokenName", () => {
  it("takes the first whitespace-delimited word", () => {
    expect(defaultSpokenName("Sofia Maria Esposito")).toBe("Sofia");
  });

  it("returns a single-word name unchanged", () => {
    expect(defaultSpokenName("Salvatore")).toBe("Salvatore");
  });

  it("trims surrounding whitespace before taking the first word", () => {
    expect(defaultSpokenName("  Alex Boudreaux  ")).toBe("Alex");
  });

  it("returns the trimmed whole for a whitespace-only string", () => {
    expect(defaultSpokenName("   ")).toBe("");
  });
});
