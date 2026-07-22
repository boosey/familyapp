/**
 * #337 — pure reconcile start-side / complementary-candidate rules (UI eligibility; core still
 * re-checks steward + mention→account merge). Placeholders never start or appear as candidates.
 */
import { describe, expect, it } from "vitest";
import {
  canOfferReconcile,
  complementaryCandidates,
  reconcileApiIds,
  reconcileSideOf,
  shouldPushReconcileTreeAnchor,
  type ReconcilePersonView,
} from "./reconcile-eligibility";

function person(
  over: Partial<ReconcilePersonView> & Pick<ReconcilePersonView, "personId">,
): ReconcilePersonView {
  return {
    personId: over.personId,
    displayName: "displayName" in over ? (over.displayName ?? null) : over.personId,
    identified: over.identified ?? true,
    isActiveMember: over.isActiveMember ?? false,
    hasAccount: over.hasAccount ?? false,
    isMention: over.isMention ?? false,
  };
}

const mention = person({
  personId: "mia-mention",
  displayName: "Mia",
  isMention: true,
  identified: true,
});
const member = person({
  personId: "mia-real",
  displayName: "Mia Real",
  isActiveMember: true,
  hasAccount: true,
});
const placeholder = person({
  personId: "bridge",
  displayName: null,
  isMention: true,
  identified: false,
});
const memberNoAccount = person({
  personId: "invitee",
  displayName: "Pending",
  isActiveMember: true,
  hasAccount: false,
});

describe("reconcileSideOf", () => {
  it("classifies identified mentions as the mention (loser) side", () => {
    expect(reconcileSideOf(mention)).toBe("mention");
  });

  it("classifies active members with accounts as the member (winner) side", () => {
    expect(reconcileSideOf(member)).toBe("member");
  });

  it("excludes placeholders even when origin is mention", () => {
    expect(reconcileSideOf(placeholder)).toBeNull();
  });

  it("excludes members without an account", () => {
    expect(reconcileSideOf(memberNoAccount)).toBeNull();
  });
});

describe("complementaryCandidates", () => {
  const pool = [mention, member, placeholder, memberNoAccount];

  it("from a mention, returns only member-with-account candidates", () => {
    expect(complementaryCandidates(mention, pool).map((p) => p.personId)).toEqual(["mia-real"]);
  });

  it("from a member-with-account, returns only identified-mention candidates", () => {
    expect(complementaryCandidates(member, pool).map((p) => p.personId)).toEqual(["mia-mention"]);
  });

  it("never includes the start person or placeholders", () => {
    const fromMention = complementaryCandidates(mention, [...pool, mention]);
    expect(fromMention.every((p) => p.personId !== mention.personId)).toBe(true);
    expect(fromMention.every((p) => p.identified)).toBe(true);
  });

  it("returns empty when start is ineligible", () => {
    expect(complementaryCandidates(placeholder, pool)).toEqual([]);
  });
});

describe("canOfferReconcile", () => {
  const pool = [mention, member];

  it("is true only for stewards when complementary candidates exist", () => {
    expect(canOfferReconcile(true, mention, pool)).toBe(true);
    expect(canOfferReconcile(true, member, pool)).toBe(true);
    expect(canOfferReconcile(false, mention, pool)).toBe(false);
  });

  it("is false for a steward when the picker would be empty (H+)", () => {
    expect(canOfferReconcile(true, mention, [mention, placeholder])).toBe(false);
    expect(canOfferReconcile(true, member, [member, memberNoAccount])).toBe(false);
  });
});

describe("reconcileApiIds", () => {
  it("maps mention-start + member-pick to mentionPersonId + accountPersonId", () => {
    expect(reconcileApiIds(mention, member)).toEqual({
      mentionPersonId: "mia-mention",
      accountPersonId: "mia-real",
    });
  });

  it("maps member-start + mention-pick the same way (UI start-side → API)", () => {
    expect(reconcileApiIds(member, mention)).toEqual({
      mentionPersonId: "mia-mention",
      accountPersonId: "mia-real",
    });
  });

  it("returns null for same-side or ineligible pairs", () => {
    expect(reconcileApiIds(mention, placeholder)).toBeNull();
    expect(reconcileApiIds(member, memberNoAccount)).toBeNull();
  });
});

describe("shouldPushReconcileTreeAnchor", () => {
  it("pushes only on tree when the winner is not already the anchor", () => {
    expect(shouldPushReconcileTreeAnchor("tree", null, "mia-real")).toBe(true);
    expect(shouldPushReconcileTreeAnchor("tree", "other", "mia-real")).toBe(true);
    expect(shouldPushReconcileTreeAnchor("tree", "mia-real", "mia-real")).toBe(false);
    expect(shouldPushReconcileTreeAnchor("list", null, "mia-real")).toBe(false);
  });
});
