/**
 * #283 — Family List people-index projection (list-data seam).
 *
 * Pure merge of members + edged kin + unplaced into one searchable row model with
 * membership-first badges (Member vs tree-only). No mutation fields.
 */
import { describe, expect, it } from "vitest";
import type { FamilyMemberView, KinListEntry, PlacedPersonView, UnplacedMember } from "@chronicle/core";
import { projectFamilyListPeople } from "@/lib/family-list-people";

function kin(over: Partial<KinListEntry> & { personId: string }): KinListEntry {
  return {
    personId: over.personId,
    relation: over.relation ?? "parent",
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
  };
}

function member(over: Partial<FamilyMemberView> & { personId: string }): FamilyMemberView {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    role: over.role ?? "member",
  };
}

function placed(over: Partial<PlacedPersonView> & { personId: string }): PlacedPersonView {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
  };
}

function unplaced(over: Partial<UnplacedMember> & { personId: string }): UnplacedMember {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    role: over.role ?? "member",
  };
}

describe("projectFamilyListPeople (#283)", () => {
  it("unions members, edged tree-only relatives, and unplaced members into one index", () => {
    const rows = projectFamilyListPeople({
      members: [member({ personId: "self", displayName: "You" }), member({ personId: "rosa", displayName: "Rosa" })],
      unplaced: [unplaced({ personId: "rosa", displayName: "Rosa" })],
      kin: [kin({ personId: "eleanor", displayName: "Eleanor", relation: "parent" })],
      placed: [
        placed({ personId: "self", displayName: "You" }),
        placed({ personId: "eleanor", displayName: "Eleanor" }),
      ],
    });

    const byId = Object.fromEntries(rows.map((r) => [r.personId, r]));
    expect(Object.keys(byId).sort()).toEqual(["eleanor", "rosa", "self"]);

    // Active members (including unplaced Rosa) → Member badge.
    expect(byId.self!.membership).toBe("member");
    expect(byId.rosa!.membership).toBe("member");
    expect(byId.rosa!.relation).toBeNull();

    // Edged kin without membership → tree-only + derived relation chip.
    expect(byId.eleanor!.membership).toBe("tree-only");
    expect(byId.eleanor!.relation).toBe("parent");
  });

  it("marks an edged relative who is also a member as Member (membership-first)", () => {
    const rows = projectFamilyListPeople({
      members: [member({ personId: "marco", displayName: "Marco" })],
      unplaced: [],
      kin: [kin({ personId: "marco", displayName: "Marco", relation: "sibling" })],
      placed: [placed({ personId: "marco", displayName: "Marco" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.membership).toBe("member");
    expect(rows[0]!.relation).toBe("sibling");
  });

  it("sorts members before tree-only, then by name", () => {
    const rows = projectFamilyListPeople({
      members: [member({ personId: "z", displayName: "Zed" }), member({ personId: "a", displayName: "Ann" })],
      unplaced: [],
      kin: [kin({ personId: "b", displayName: "Bea", relation: "cousin" })],
      placed: [placed({ personId: "b", displayName: "Bea" })],
    });
    expect(rows.map((r) => r.personId)).toEqual(["a", "z", "b"]);
  });

  it("does not invent Origin / Account / mention badge values", () => {
    const rows = projectFamilyListPeople({
      members: [member({ personId: "m" })],
      unplaced: [],
      kin: [kin({ personId: "t", relation: "parent" })],
      placed: [placed({ personId: "t" })],
    });
    for (const row of rows) {
      expect(row.membership === "member" || row.membership === "tree-only").toBe(true);
    }
  });
});
