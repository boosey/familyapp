/**
 * Regression tests for the invite family-target guard (lib/invite-scope · resolveInviteFamilyId).
 *
 * An invitation is single-family. The client select forces an explicit choice (a disabled placeholder
 * when the inviter belongs to >1 family), but a crafted POST can omit `familyId`. This pure resolver
 * is the server-side backstop — mirroring `resolveComposeFamilies` for the Ask compose surface — so
 * an invite is NEVER silently created against an arbitrary or missing family. Membership in the chosen
 * family is still enforced downstream by core (createInvitation / createLinkSession); this only decides
 * WHICH family id reaches that write path (or refuses).
 */
import { describe, expect, it } from "vitest";
import { resolveInviteFamilyId } from "../lib/invite-scope";

describe("resolveInviteFamilyId", () => {
  it("returns a deliberately chosen family the inviter belongs to", () => {
    expect(resolveInviteFamilyId("famA", ["famA", "famB"])).toBe("famA");
  });

  it("auto-resolves an empty target to the lone family (unambiguous)", () => {
    expect(resolveInviteFamilyId("", ["famA"])).toBe("famA");
  });

  it("THROWS on an empty target when the inviter has >1 active family (the dangerous case)", () => {
    expect(() => resolveInviteFamilyId("", ["famA", "famB"])).toThrow();
  });

  it("THROWS on an empty target when the inviter has NO active family", () => {
    expect(() => resolveInviteFamilyId("", [])).toThrow();
  });

  it("THROWS on a family the inviter is NOT a member of when they have several (never redirect blindly)", () => {
    // A crafted id for a family the inviter isn't in, with >1 own family → ambiguous → refuse.
    expect(() => resolveInviteFamilyId("famX", ["famA", "famB"])).toThrow();
  });

  it("redirects a bogus id to the lone family when the inviter has exactly one (safe)", () => {
    // A crafted non-member id but only one own family — the only family they could invite into.
    expect(resolveInviteFamilyId("famX", ["famA"])).toBe("famA");
  });

  it("trims whitespace-only input and treats it as empty", () => {
    expect(() => resolveInviteFamilyId("   ", ["famA", "famB"])).toThrow();
    expect(resolveInviteFamilyId("  famA  ", ["famA", "famB"])).toBe("famA");
  });
});
