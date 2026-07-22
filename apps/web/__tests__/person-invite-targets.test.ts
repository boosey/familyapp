/**
 * #334 — the person-bound Invite modal's family designator: exclude Families the invitee already
 * holds an active membership in, auto-seed the lone survivor, seed nothing when several/zero remain.
 */
import { describe, expect, it } from "vitest";
import { resolvePersonInviteFamilies, type PersonInviteFamilyOption } from "@/lib/person-invite-targets";

const BOUDREAUX: PersonInviteFamilyOption = { id: "fam-boudreaux", name: "Boudreaux" };
const CARNEY: PersonInviteFamilyOption = { id: "fam-carney", name: "Carney" };
const RICCI: PersonInviteFamilyOption = { id: "fam-ricci", name: "Ricci" };

describe("resolvePersonInviteFamilies (#334)", () => {
  it("excludes families where the invitee already holds an active membership", () => {
    const result = resolvePersonInviteFamilies([BOUDREAUX, CARNEY, RICCI], ["fam-carney"]);
    expect(result.families.map((f) => f.id)).toEqual(["fam-boudreaux", "fam-ricci"]);
  });

  it("auto-seeds the lone remaining eligible family", () => {
    const result = resolvePersonInviteFamilies([BOUDREAUX, CARNEY], ["fam-carney"]);
    expect(result.families.map((f) => f.id)).toEqual(["fam-boudreaux"]);
    expect(result.seededFamilyId).toBe("fam-boudreaux");
  });

  it("seeds nothing when several families remain eligible", () => {
    const result = resolvePersonInviteFamilies([BOUDREAUX, CARNEY, RICCI], []);
    expect(result.families).toHaveLength(3);
    expect(result.seededFamilyId).toBeNull();
  });

  it("seeds nothing when zero families remain eligible", () => {
    const result = resolvePersonInviteFamilies([CARNEY], ["fam-carney"]);
    expect(result.families).toHaveLength(0);
    expect(result.seededFamilyId).toBeNull();
  });

  it("a membership in a family the viewer isn't in doesn't affect eligibility", () => {
    // The invitee's OTHER memberships (families the viewer doesn't belong to) are irrelevant — only
    // ids that also appear in the viewer's own candidate set can ever be excluded.
    const result = resolvePersonInviteFamilies([BOUDREAUX], ["fam-somewhere-else"]);
    expect(result.families.map((f) => f.id)).toEqual(["fam-boudreaux"]);
    expect(result.seededFamilyId).toBe("fam-boudreaux");
  });
});
