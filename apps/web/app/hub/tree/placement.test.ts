/**
 * Placement typed write seam (#318 / ADR-0027) — mint marshalling + offer-never-silent.
 * Zone→relation mapping stays covered; these tests hit the Placement interface itself.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertPartnerChildrenOfferResolved,
  commitPlacement,
  mintPlacementToAddRelativeInput,
  partnerChildrenOfferRequired,
  relationFromZone,
  resolvePartnerChildrenOffer,
  type MintPlacement,
  type Placement,
} from "./placement";

describe("relationFromZone (#286 / ADR-0027)", () => {
  it("maps top/bottom/side to parent/child/partner (no sibling zone)", () => {
    expect(relationFromZone("top")).toBe("parent");
    expect(relationFromZone("bottom")).toBe("child");
    expect(relationFromZone("side")).toBe("partner");
  });
});

describe("mintPlacementToAddRelativeInput (#318)", () => {
  it("marshals mint Placement to typed AddRelativeInput without FormData", () => {
    const placement: MintPlacement = {
      kind: "mint",
      familyId: "fam-1",
      relation: "child",
      receiverPersonId: "anchor",
      displayName: "  Ada  ",
      nature: "adoptive",
      coParentPersonIds: ["p2", "p2"],
    };
    expect(mintPlacementToAddRelativeInput(placement)).toEqual({
      familyId: "fam-1",
      relation: "child",
      anchorPersonId: "anchor",
      displayName: "Ada",
      nature: "adoptive",
      coParentPersonId: "p2",
      coParentPersonIds: ["p2"],
    });
  });

  it("forwards partner stepParentOfChildIds when non-empty; omits empty name", () => {
    const placement: MintPlacement = {
      kind: "mint",
      familyId: "fam-1",
      relation: "partner",
      receiverPersonId: "anchor",
      displayName: "   ",
      stepParentOfChildIds: ["kid-1", "kid-1"],
    };
    expect(mintPlacementToAddRelativeInput(placement)).toEqual({
      familyId: "fam-1",
      relation: "partner",
      anchorPersonId: "anchor",
      stepParentOfChildIds: ["kid-1"],
    });
  });

  it("partner decline (empty step list) does not invent silent step edges", () => {
    const placement: MintPlacement = {
      kind: "mint",
      familyId: "fam-1",
      relation: "partner",
      receiverPersonId: "anchor",
      displayName: "Sam",
      stepParentOfChildIds: [],
    };
    const input = mintPlacementToAddRelativeInput(placement);
    expect(input.stepParentOfChildIds).toBeUndefined();
    expect(input.displayName).toBe("Sam");
  });
});

describe("ADR-0027 offer-never-silent on Placement (#318)", () => {
  it("partnerChildrenOfferRequired is true only for partner with kids", () => {
    expect(partnerChildrenOfferRequired("partner", 2)).toBe(true);
    expect(partnerChildrenOfferRequired("partner", 0)).toBe(false);
    expect(partnerChildrenOfferRequired("child", 2)).toBe(false);
  });

  it("rejects partner Placement with kids when stepParentOfChildIds is undefined", () => {
    const placement: Placement = {
      kind: "mint",
      familyId: "F",
      relation: "partner",
      receiverPersonId: "a",
      displayName: "New",
    };
    expect(assertPartnerChildrenOfferResolved(placement, ["kid-1"])).toEqual({
      ok: false,
      error: "offer-unresolved",
    });
  });

  it("accepts explicit empty array (declined) and non-empty (accepted)", () => {
    const declined: Placement = {
      kind: "link",
      familyId: "F",
      existingPersonId: "u1",
      relation: "partner",
      receiverPersonId: "a",
      stepParentOfChildIds: [],
    };
    expect(assertPartnerChildrenOfferResolved(declined, ["kid-1"])).toEqual({ ok: true });

    const accepted: Placement = {
      ...declined,
      stepParentOfChildIds: ["kid-1"],
    };
    expect(assertPartnerChildrenOfferResolved(accepted, ["kid-1"])).toEqual({ ok: true });
  });

  it("commitPlacement blocks unresolved partner offer when offerContext is supplied", async () => {
    const onMint = vi.fn(async () => ({ ok: true as const }));
    const placement: MintPlacement = {
      kind: "mint",
      familyId: "F",
      relation: "partner",
      receiverPersonId: "a",
      displayName: "Pat",
      // stepParentOfChildIds omitted — silent path forbidden
    };
    const res = await commitPlacement(placement, { onMint }, { anchorChildIds: ["kid-1"] });
    expect(res).toEqual({ ok: false, error: "offer-unresolved" });
    expect(onMint).not.toHaveBeenCalled();
  });

  it("commitPlacement mints through typed adapter after offer resolved", async () => {
    const onMint = vi.fn(async (p: MintPlacement) => {
      expect(p.kind).toBe("mint");
      expect(p.stepParentOfChildIds).toEqual(["kid-1"]);
      return { ok: true as const };
    });
    const placement: MintPlacement = {
      kind: "mint",
      familyId: "F",
      relation: "partner",
      receiverPersonId: "a",
      displayName: "Pat",
      stepParentOfChildIds: ["kid-1"],
    };
    const res = await commitPlacement(placement, { onMint }, { anchorChildIds: ["kid-1"] });
    expect(res).toEqual({ ok: true });
    expect(onMint).toHaveBeenCalledTimes(1);
  });

  it("invite-plan is shaped and routes to adapter without mint/link", async () => {
    const onInvitePlan = vi.fn(async () => ({ ok: true as const }));
    const onMint = vi.fn(async () => ({ ok: true as const }));
    const res = await commitPlacement(
      {
        kind: "invite-plan",
        familyId: "F",
        relation: "partner",
        receiverPersonId: "a",
        displayName: "Guest",
        contactHint: "guest@example.com",
        inviteRelationship: "wife",
        stepParentOfChildIds: [],
      },
      { onInvitePlan, onMint },
      { anchorChildIds: ["kid-1"] },
    );
    expect(res).toEqual({ ok: true });
    expect(onInvitePlan).toHaveBeenCalledTimes(1);
    expect(onMint).not.toHaveBeenCalled();
  });
});

describe("resolvePartnerChildrenOffer (#318 — single orchestration)", () => {
  const kids = [{ id: "kid-1" }, { id: "kid-2" }];

  it("prompts when partner + kids and selection not yet resolved", () => {
    const r = resolvePartnerChildrenOffer({
      relation: "partner",
      children: kids,
      pendingSelection: null,
    });
    expect(r.type).toBe("show-offer");
    if (r.type === "show-offer") {
      expect([...r.initialSelection]).toEqual(["kid-1", "kid-2"]);
    }
  });

  it("proceeds with explicit selection (including empty decline)", () => {
    const accepted = resolvePartnerChildrenOffer({
      relation: "partner",
      children: kids,
      pendingSelection: new Set(["kid-1"]),
    });
    expect(accepted).toEqual({ type: "ready", stepParentOfChildIds: ["kid-1"] });

    const declined = resolvePartnerChildrenOffer({
      relation: "partner",
      children: kids,
      pendingSelection: new Set(),
    });
    expect(declined).toEqual({ type: "ready", stepParentOfChildIds: [] });
  });

  it("skips offer for non-partner or no kids", () => {
    expect(
      resolvePartnerChildrenOffer({
        relation: "child",
        children: kids,
        pendingSelection: null,
      }),
    ).toEqual({ type: "ready", stepParentOfChildIds: undefined });
    expect(
      resolvePartnerChildrenOffer({
        relation: "partner",
        children: [],
        pendingSelection: null,
      }),
    ).toEqual({ type: "ready", stepParentOfChildIds: undefined });
  });
});
