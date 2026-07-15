/**
 * Unit tests for the action-flow family DESIGNATOR helpers (ADR-0021, issue #49).
 *
 * `seedDesignatorFamily` decides the single family an Invite/Ask flow defaults to, SEEDED from the
 * browse filter; `resolveDesignatorFamily` is the server-side backstop that settles which single id
 * reaches the write path (or refuses). Both mirror the single-family invariant of the action flows.
 */
import { describe, expect, it } from "vitest";
import type { FamilyFilter } from "@/lib/family-filter";
import {
  seedDesignatorFamily,
  resolveDesignatorFamily,
} from "@/lib/family-designator";

const ALL: FamilyFilter = { kind: "all" };
const NONE: FamilyFilter = { kind: "none" };
const some = (...ids: string[]): FamilyFilter => ({ kind: "some", ids });

describe("seedDesignatorFamily", () => {
  it("returns the lone active family regardless of the filter", () => {
    expect(seedDesignatorFamily(ALL, ["fam-a"])).toBe("fam-a");
    expect(seedDesignatorFamily(NONE, ["fam-a"])).toBe("fam-a");
    expect(seedDesignatorFamily(some("fam-a"), ["fam-a"])).toBe("fam-a");
    // Even a filter naming a different (non-member) id can't matter — one family is always unambiguous.
    expect(seedDesignatorFamily(some("fam-z"), ["fam-a"])).toBe("fam-a");
  });

  it("returns the single family a filter names (some[1]) when the viewer has several", () => {
    expect(seedDesignatorFamily(some("fam-b"), ["fam-a", "fam-b", "fam-c"])).toBe("fam-b");
  });

  it("returns null for an all/none/multi filter when the viewer has several families", () => {
    expect(seedDesignatorFamily(ALL, ["fam-a", "fam-b"])).toBeNull();
    expect(seedDesignatorFamily(NONE, ["fam-a", "fam-b"])).toBeNull();
    expect(seedDesignatorFamily(some("fam-a", "fam-b"), ["fam-a", "fam-b", "fam-c"])).toBeNull();
  });

  it("returns null for an all/none filter when the viewer has no active family", () => {
    // In practice parseFamilyFilter drops non-member ids, so a `some` filter never survives with a
    // non-member id against an empty active set — the reachable no-family case is all/none, both null.
    expect(seedDesignatorFamily(ALL, [])).toBeNull();
    expect(seedDesignatorFamily(NONE, [])).toBeNull();
  });
});

describe("resolveDesignatorFamily", () => {
  it("returns a deliberate valid pick of a family the viewer is in", () => {
    expect(resolveDesignatorFamily("fam-b", ["fam-a", "fam-b"])).toBe("fam-b");
  });

  it("collapses an empty pick to the lone family", () => {
    expect(resolveDesignatorFamily("", ["fam-a"])).toBe("fam-a");
  });

  it("collapses a bogus non-member id to the lone family", () => {
    expect(resolveDesignatorFamily("fam-z", ["fam-a"])).toBe("fam-a");
  });

  it("throws on an empty pick with several families (the server-side guard)", () => {
    expect(() => resolveDesignatorFamily("", ["fam-a", "fam-b"])).toThrow();
  });

  it("throws on a bogus non-member id with several families", () => {
    expect(() => resolveDesignatorFamily("fam-z", ["fam-a", "fam-b"])).toThrow();
  });

  // Regression (#49 cold review): a 0-active-family asker (pending-only, admitted to the hub with NO
  // member-only gate on the Ask tab) must NOT throw at the resolver boundary. The pre-#49 multi-select
  // path (`resolveComposeFamilies([], []) → []`) submitted a familyless ask; the single-select
  // designator preserves that by returning null (⇒ the Ask caller passes no familyIds). core's
  // createAsk remains the authority — it re-validates and, for a truly familyless asker, rejects with
  // its own "shares no active family with the target" AuthorizationError rather than this confusing one.
  it("returns null (not a throw) when the viewer has no active family — familyless ask is legal", () => {
    expect(resolveDesignatorFamily("", [])).toBeNull();
    // A bogus id changes nothing when there are zero families to validate against.
    expect(resolveDesignatorFamily("fam-z", [])).toBeNull();
  });
});
