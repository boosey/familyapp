/**
 * Unit tests for the shared `?families=` browse filter (ADR-0021 · lib/family-filter.ts).
 *
 * Covers every parse branch (absent→all, none→none, valid csv→some, all-unknown→all, mixed
 * valid+garbage→some(valid only), full-set→all, repeated string[] param), the three derivations
 * (deriveSingleScope, selectedIdList, serializeSelection), and a parse→serialize round-trip.
 */
import { describe, expect, it } from "vitest";
import {
  FAMILIES_NONE,
  parseFamilyFilter,
  deriveSingleScope,
  selectedIdList,
  serializeSelection,
  type FamilyFilter,
} from "@/lib/family-filter";

const ACTIVE = ["fam-a", "fam-b", "fam-c"];

describe("parseFamilyFilter", () => {
  it("absent (undefined) → all", () => {
    expect(parseFamilyFilter(undefined, ACTIVE)).toEqual({ kind: "all" });
  });

  it("empty string → all", () => {
    expect(parseFamilyFilter("", ACTIVE)).toEqual({ kind: "all" });
  });

  // Regression (PR #55 Gemini review): a `null` from cleared query state / a mock must be treated as
  // absent, not crash on `.split`.
  it("null (cleared query state) → all, never throws", () => {
    expect(() => parseFamilyFilter(null, ACTIVE)).not.toThrow();
    expect(parseFamilyFilter(null, ACTIVE)).toEqual({ kind: "all" });
  });

  it("the 'none' sentinel → none", () => {
    expect(parseFamilyFilter(FAMILIES_NONE, ACTIVE)).toEqual({ kind: "none" });
  });

  it("a valid csv subset → some (in active-set order)", () => {
    // Requested out of order — the result preserves ACTIVE order.
    expect(parseFamilyFilter("fam-c,fam-a", ACTIVE)).toEqual({
      kind: "some",
      ids: ["fam-a", "fam-c"],
    });
  });

  it("all-unknown ids → all (never-trust fallback)", () => {
    expect(parseFamilyFilter("nope,also-nope", ACTIVE)).toEqual({ kind: "all" });
  });

  it("mixed valid + garbage → some (valid ids only)", () => {
    expect(parseFamilyFilter("fam-b,crafted,fam-a", ACTIVE)).toEqual({
      kind: "some",
      ids: ["fam-a", "fam-b"],
    });
  });

  it("the full active set (any order) → canonical all", () => {
    expect(parseFamilyFilter("fam-c,fam-b,fam-a", ACTIVE)).toEqual({ kind: "all" });
  });

  it("trims whitespace and drops empty segments", () => {
    expect(parseFamilyFilter(" fam-a , , fam-b ", ACTIVE)).toEqual({
      kind: "some",
      ids: ["fam-a", "fam-b"],
    });
  });

  it("dedups a repeated id", () => {
    expect(parseFamilyFilter("fam-a,fam-a", ACTIVE)).toEqual({
      kind: "some",
      ids: ["fam-a"],
    });
  });

  it("a repeated string[] param is joined then parsed", () => {
    expect(parseFamilyFilter(["fam-a", "fam-b"], ACTIVE)).toEqual({
      kind: "some",
      ids: ["fam-a", "fam-b"],
    });
  });

  it("a repeated string[] that covers the full set → all", () => {
    expect(parseFamilyFilter(["fam-a", "fam-b", "fam-c"], ACTIVE)).toEqual({ kind: "all" });
  });

  it("with no active families, any csv → all", () => {
    expect(parseFamilyFilter("fam-a", [])).toEqual({ kind: "all" });
  });

  it("with no active families, 'none' is still none", () => {
    expect(parseFamilyFilter(FAMILIES_NONE, [])).toEqual({ kind: "none" });
  });
});

describe("deriveSingleScope", () => {
  it("all → 'all'", () => {
    expect(deriveSingleScope({ kind: "all" })).toBe("all");
  });
  it("none → 'all'", () => {
    expect(deriveSingleScope({ kind: "none" })).toBe("all");
  });
  it("some → the first id", () => {
    expect(deriveSingleScope({ kind: "some", ids: ["fam-b", "fam-c"] })).toBe("fam-b");
  });
});

describe("selectedIdList", () => {
  it("all → every active id", () => {
    expect(selectedIdList({ kind: "all" }, ACTIVE)).toEqual(ACTIVE);
  });
  it("none → []", () => {
    expect(selectedIdList({ kind: "none" }, ACTIVE)).toEqual([]);
  });
  it("some → its ids", () => {
    const f: FamilyFilter = { kind: "some", ids: ["fam-b"] };
    expect(selectedIdList(f, ACTIVE)).toEqual(["fam-b"]);
  });
});

describe("serializeSelection", () => {
  it("the full set → null (omit the param = absent = all)", () => {
    expect(serializeSelection(["fam-a", "fam-b", "fam-c"], ACTIVE)).toBeNull();
  });
  it("the empty set → the 'none' sentinel", () => {
    expect(serializeSelection([], ACTIVE)).toBe(FAMILIES_NONE);
  });
  it("a strict subset → the csv join", () => {
    expect(serializeSelection(["fam-a", "fam-c"], ACTIVE)).toBe("fam-a,fam-c");
  });
});

describe("parse → serialize round-trip", () => {
  it("a subset survives a round-trip", () => {
    const filter = parseFamilyFilter("fam-a,fam-c", ACTIVE);
    const ids = selectedIdList(filter, ACTIVE);
    const serialized = serializeSelection(ids, ACTIVE);
    expect(serialized).toBe("fam-a,fam-c");
    expect(parseFamilyFilter(serialized ?? undefined, ACTIVE)).toEqual(filter);
  });

  it("all round-trips through null back to all", () => {
    const filter = parseFamilyFilter(undefined, ACTIVE);
    const ids = selectedIdList(filter, ACTIVE);
    const serialized = serializeSelection(ids, ACTIVE);
    expect(serialized).toBeNull();
    expect(parseFamilyFilter(serialized ?? undefined, ACTIVE)).toEqual({ kind: "all" });
  });

  it("none round-trips through the sentinel back to none", () => {
    const filter = parseFamilyFilter(FAMILIES_NONE, ACTIVE);
    const ids = selectedIdList(filter, ACTIVE);
    const serialized = serializeSelection(ids, ACTIVE);
    expect(serialized).toBe(FAMILIES_NONE);
    expect(parseFamilyFilter(serialized ?? undefined, ACTIVE)).toEqual({ kind: "none" });
  });
});
