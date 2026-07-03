/**
 * Unit tests for the /welcome name pre-fill helper. The load-bearing behavior: an email-prefix
 * fallback displayName yields a BLANK field (forcing a real name), while a genuine Clerk name is
 * passed through for one-tap confirmation.
 */
import { describe, expect, it } from "vitest";
import { initialOnboardingName } from "@/app/welcome/onboarding-name";

describe("initialOnboardingName", () => {
  it("returns '' when displayName equals the email local-part", () => {
    expect(
      initialOnboardingName("alexboudreaux.dev", "alexboudreaux.dev@gmail.com"),
    ).toBe("");
  });

  it("matches the local-part case-insensitively and after trimming", () => {
    expect(
      initialOnboardingName("  AlexBoudreaux.Dev  ", "alexboudreaux.dev@gmail.com"),
    ).toBe("");
  });

  it("passes a real Clerk name through unchanged", () => {
    expect(
      initialOnboardingName("Alex Boudreaux", "alexboudreaux.dev@gmail.com"),
    ).toBe("Alex Boudreaux");
  });

  it("passes a real name through even when it shares a first token with the local-part", () => {
    // "alex" (local-part) !== "Alex Boudreaux" — only a full match blanks the field.
    expect(initialOnboardingName("Alex Boudreaux", "alex@gmail.com")).toBe(
      "Alex Boudreaux",
    );
  });

  it("returns the displayName unchanged when the email is empty (no local-part to match)", () => {
    expect(initialOnboardingName("Alex Boudreaux", "")).toBe("Alex Boudreaux");
  });
});
