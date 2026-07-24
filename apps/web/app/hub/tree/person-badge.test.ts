import { describe, expect, it } from "vitest";
import { personCardBadgeFor, type PersonBadgeInput } from "./person-badge";

/** A living, identified, tree-only, non-steward person with no pending invite (the eligible baseline). */
function base(overrides: Partial<PersonBadgeInput> = {}): PersonBadgeInput {
  return {
    identified: true,
    lifeStatus: "living",
    membership: "tree-only",
    isSteward: false,
    inviteStatus: "not-applicable",
    relationToRoot: "parent",
    ...overrides,
  };
}

describe("personCardBadgeFor (#372)", () => {
  it("eligible: living, identified, tree-only, no pending invite", () => {
    expect(personCardBadgeFor(base())).toBe("eligible");
  });

  it("steward takes precedence over eligible", () => {
    expect(personCardBadgeFor(base({ isSteward: true }))).toBe("steward");
  });

  it("invited takes precedence over eligible", () => {
    expect(personCardBadgeFor(base({ inviteStatus: "pending" }))).toBe("invited");
  });

  it("steward takes precedence over invited", () => {
    expect(personCardBadgeFor(base({ isSteward: true, inviteStatus: "pending" }))).toBe("steward");
  });

  it("anonymous bridge (identified:false) → null", () => {
    expect(personCardBadgeFor(base({ identified: false }))).toBeNull();
  });

  it("self (focus-root) → null", () => {
    expect(personCardBadgeFor(base({ relationToRoot: "self" }))).toBeNull();
  });

  it("member (not tree-only) → null", () => {
    expect(personCardBadgeFor(base({ membership: "member" }))).toBeNull();
  });

  it("deceased tree-only → null", () => {
    expect(personCardBadgeFor(base({ lifeStatus: "deceased" }))).toBeNull();
  });
});
