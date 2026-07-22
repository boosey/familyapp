/**
 * #283 — Family List people-index projection (list-data seam).
 *
 * Pure merge of members + edged kin + unplaced into one searchable row model with
 * membership-first badges (Member vs tree-only). No mutation fields.
 */
import { describe, expect, it } from "vitest";
import type {
  FamilyMemberView,
  KinListEntry,
  PlacedPersonView,
  TreeNode,
  UnplacedMember,
} from "@chronicle/core";
import type { FamilyListPerson } from "@/lib/family-list-people";
import {
  hydrateFamilyListPeopleIdentity,
  projectFamilyListPeople,
  resolveListPersonNode,
} from "@/lib/family-list-people";

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

  it("#330/#334 fix — never invents identity or invite status: birthYear/deathYear/sex/inviteStatus default null/null/unknown/not-applicable (loader hydrates them)", () => {
    const rows = projectFamilyListPeople({
      members: [member({ personId: "m" })],
      unplaced: [],
      kin: [],
      placed: [],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        personId: "m",
        birthYear: null,
        deathYear: null,
        sex: "unknown",
        inviteStatus: "not-applicable",
      }),
    ]);
  });
});

describe("hydrateFamilyListPeopleIdentity (#330 fix)", () => {
  it("merges real lifeStatus/birthYear/deathYear/sex onto matching rows", () => {
    const rows = [
      person({ personId: "eleanor" }),
      person({ personId: "marco" }),
    ];
    const hydrated = hydrateFamilyListPeopleIdentity(
      rows,
      new Map([
        [
          "eleanor",
          {
            lifeStatus: "deceased" as const,
            birthYear: 1940,
            deathYear: 2010,
            sex: "female" as const,
            inviteStatus: "not-applicable" as const,
          },
        ],
        [
          "marco",
          {
            lifeStatus: "living" as const,
            birthYear: 1975,
            deathYear: null,
            sex: "male" as const,
            inviteStatus: "invitable" as const,
          },
        ],
      ]),
    );
    expect(hydrated.find((r) => r.personId === "eleanor")).toMatchObject({
      lifeStatus: "deceased",
      birthYear: 1940,
      deathYear: 2010,
      sex: "female",
      inviteStatus: "not-applicable",
    });
    expect(hydrated.find((r) => r.personId === "marco")).toMatchObject({
      lifeStatus: "living",
      birthYear: 1975,
      deathYear: null,
      sex: "male",
      inviteStatus: "invitable",
    });
  });

  it("overwrites projector's default lifeStatus: living for unplaced members without kin", () => {
    const projected = projectFamilyListPeople({
      members: [member({ personId: "rosa", displayName: "Rosa" })],
      unplaced: [unplaced({ personId: "rosa", displayName: "Rosa" })],
      kin: [],
      placed: [],
    });
    expect(projected[0]!.lifeStatus).toBe("living");

    const hydrated = hydrateFamilyListPeopleIdentity(
      projected,
      new Map([
        [
          "rosa",
          {
            lifeStatus: "deceased",
            birthYear: 1920,
            deathYear: 1995,
            sex: "female",
            inviteStatus: "not-applicable",
          },
        ],
      ]),
    );
    expect(hydrated[0]).toMatchObject({
      personId: "rosa",
      lifeStatus: "deceased",
      birthYear: 1920,
      deathYear: 1995,
      sex: "female",
    });
  });

  it("leaves a row's safe defaults untouched when no identity entry matches (defensive, should not happen)", () => {
    const rows = [person({ personId: "ghost" })];
    const hydrated = hydrateFamilyListPeopleIdentity(rows, new Map());
    expect(hydrated).toEqual(rows);
  });
});

function person(over: Partial<FamilyListPerson> & { personId: string }): FamilyListPerson {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    membership: over.membership ?? "member",
    relation: "relation" in over ? (over.relation ?? null) : null,
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

function node(over: Partial<TreeNode> & { personId: string }): TreeNode {
  return {
    personId: over.personId,
    displayName: over.displayName ?? over.personId,
    identified: over.identified ?? true,
    lifeStatus: over.lifeStatus ?? "living",
    birthYear: over.birthYear ?? null,
    deathYear: over.deathYear ?? null,
    relationToRoot: over.relationToRoot ?? null,
    hasHiddenParents: over.hasHiddenParents ?? false,
    hasHiddenChildren: over.hasHiddenChildren ?? false,
    sex: over.sex ?? "unknown",
    inviteStatus: over.inviteStatus ?? "not-applicable",
  };
}

describe("resolveListPersonNode (#330)", () => {
  it("prefers the already-materialized tree node when the person is in the current window", () => {
    const treeNode = node({
      personId: "marco",
      displayName: "Marco",
      birthYear: 1980,
      sex: "male",
      inviteStatus: "invitable",
    });
    const resolved = resolveListPersonNode(person({ personId: "marco", displayName: "Marco" }), [
      treeNode,
    ]);
    expect(resolved).toBe(treeNode);
  });

  it("synthesizes a minimal node with safe defaults when absent from the tree window", () => {
    const resolved = resolveListPersonNode(
      person({ personId: "eleanor", displayName: "Eleanor", relation: "parent", lifeStatus: "deceased" }),
      [],
    );
    expect(resolved).toEqual({
      personId: "eleanor",
      displayName: "Eleanor",
      identified: true,
      lifeStatus: "deceased",
      birthYear: null,
      deathYear: null,
      sex: "unknown",
      relationToRoot: "parent",
      hasHiddenParents: false,
      hasHiddenChildren: false,
      inviteStatus: "not-applicable",
    });
  });

  it("#330 fix — hydrates the REAL birthYear/deathYear/sex from the FamilyListPerson when synthesizing (never null/unknown for a known person)", () => {
    // This is the critical-bug regression: before the fix, a person absent from `tree.nodes` (any
    // unplaced member, or a tree-only relative outside the rendered window) synthesized
    // birthYear/deathYear: null and sex: "unknown" UNCONDITIONALLY, even when the loader had real
    // values for them — so an Edit→Save from List (which always sends these fields) could silently
    // wipe a real DOB/sex. The node must now carry the FamilyListPerson's own hydrated identity.
    const resolved = resolveListPersonNode(
      person({
        personId: "eleanor",
        displayName: "Eleanor",
        relation: "parent",
        lifeStatus: "deceased",
        birthYear: 1940,
        deathYear: 2010,
        sex: "female",
      }),
      [], // NOT in the current tree window — must synthesize.
    );
    expect(resolved.birthYear).toBe(1940);
    expect(resolved.deathYear).toBe(2010);
    expect(resolved.sex).toBe("female");
  });

  it("#334 fix — synthesizes the person's REAL inviteStatus, not a hardcoded not-applicable", () => {
    // Critical-bug regression: `resolveListPersonNode` used to hardcode `inviteStatus: "not-applicable"`
    // for every synthesized node — a person outside the tree window (any unplaced member, or a
    // tree-only relative outside the rendered window) could never show List's Invite affordance even
    // when the loader-hydrated `FamilyListPerson.inviteStatus` was real and `"invitable"`.
    const resolved = resolveListPersonNode(
      person({
        personId: "rosa",
        displayName: "Rosa",
        identified: true,
        lifeStatus: "living",
        inviteStatus: "invitable",
      }),
      [],
    );
    expect(resolved.inviteStatus).toBe("invitable");
  });

  it("synthesizes not-applicable invite status when the hydrated FamilyListPerson carries it (e.g. deceased/no gap)", () => {
    const resolved = resolveListPersonNode(
      person({ personId: "rosa", displayName: "Rosa", identified: true, lifeStatus: "living" }),
      [],
    );
    expect(resolved.inviteStatus).toBe("not-applicable");
  });
});
