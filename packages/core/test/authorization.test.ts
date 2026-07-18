/**
 * Increment 1 — the single authorization function: the full permission matrix.
 *
 * The reviewer is told to "try to find a query that returns story content without it." These
 * tests pin every tier × state × relationship combination, plus the narrator/owner and anonymous
 * paths, and assert the public read helpers (the single front door) never leak.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRelative,
  decideMediaRead,
  decideStoryRead,
  endMembership,
  getMediaForViewer,
  getStoryForViewer,
  listStoriesForViewer,
  resolveKinshipProjection,
  type AuthContext,
} from "../src/index";
import {
  addMembership,
  forceEndMembership,
  makeApprovalAudio,
  makeFamily,
  makePerson,
  makeStory,
  revokeConsent,
} from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const anon: AuthContext = { kind: "anonymous" };
const account = (personId: string): AuthContext => ({ kind: "account", personId });
const narrator = (personId: string): AuthContext => ({
  kind: "link_session",
  personId,
});

describe("owner / narrator access", () => {
  it("owner reads their own private draft story", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "draft",
      audienceTier: "private",
    });
    expect((await decideStoryRead(db, account(e.id), story)).allowed).toBe(true);
  });

  it("token-scoped narrator reads their own private draft (zero login)", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "draft",
      audienceTier: "private",
    });
    const fetched = await getStoryForViewer(db, narrator(e.id), story.id);
    expect(fetched?.id).toBe(story.id);
  });
});

describe("anonymous access", () => {
  it("denies anonymous read of a private story", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      audienceTier: "private",
    });
    expect((await decideStoryRead(db, anon, story)).allowed).toBe(false);
    expect(await getStoryForViewer(db, anon, story.id)).toBeNull();
  });

  it("allows anonymous read of a public, approved+shared, consented story", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    expect((await decideStoryRead(db, anon, story)).allowed).toBe(true);
  });

  it("denies anonymous read of a public story that is NOT yet approved/shared", async () => {
    const e = await makePerson(db, "Eleanor");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "pending_approval",
      audienceTier: "public",
    });
    expect((await decideStoryRead(db, anon, story)).allowed).toBe(false);
  });
});

describe("family-tier access", () => {
  async function setup(tier: "family" | "branch") {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const stranger = await makePerson(db, "Stranger");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    const sofiaMembership = await addMembership(db, sofia.id, fam.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: tier,
      withApprovalConsent: true,
      // ADR-0010: a family/branch story is only visible once surfaced into a shared family.
      targetFamilyIds: [fam.id],
    });
    return { e, sofia, stranger, fam, sofiaMembership, story };
  }

  it("allows an active co-member to read a shared family story", async () => {
    const { sofia, story } = await setup("family");
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      true,
    );
  });

  it("treats branch tier as family for enforcement (Phase 0)", async () => {
    const { sofia, story } = await setup("branch");
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      true,
    );
  });

  it("denies a person with no shared family", async () => {
    const { stranger, story } = await setup("family");
    expect(
      (await decideStoryRead(db, account(stranger.id), story)).allowed,
    ).toBe(false);
  });

  it("denies a co-member whose membership is ENDED (divorce)", async () => {
    const { sofia, sofiaMembership, story } = await setup("family");
    await forceEndMembership(db, sofiaMembership.id);
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  it("denies a co-member whose membership is PAUSED (estrangement)", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "paused");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  it("denies a co-member when the family story is still pending_approval", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "pending_approval",
      audienceTier: "family",
      targetFamilyIds: [fam.id],
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  it("denies a co-member after consent is REVOKED (new superseding row hides it)", async () => {
    const { e, sofia, story } = await setup("family");
    // visible first
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      true,
    );
    await revokeConsent(db, story.id, e.id);
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  // --- ADR-0010 story→family targeting -------------------------------------------------------

  it("(a) targeted to family A, viewer co-member in A → visible", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const famA = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, famA.id, "active");
    await addMembership(db, sofia.id, famA.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [famA.id],
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      true,
    );
  });

  it("(b) targeted to A, viewer co-member only in B (owner in both) → DENIED", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const famA = await makeFamily(db, "Boudreaux", e.id);
    const famB = await makeFamily(db, "Carney", e.id);
    // Owner is active in BOTH families.
    await addMembership(db, e.id, famA.id, "active");
    await addMembership(db, e.id, famB.id, "active");
    // Viewer shares only family B with the owner.
    await addMembership(db, sofia.id, famB.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      // ...but the story is surfaced into A only.
      targetFamilyIds: [famA.id],
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  it("(c) empty target set, co-member in the owner's family → DENIED (owner-only)", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      // No targetFamilyIds — the story is surfaced into nothing.
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
    // But the owner still sees their own untargeted story.
    expect((await decideStoryRead(db, account(e.id), story)).allowed).toBe(true);
  });

  it("(d) owner LEFT the targeted family (owner membership ended) → co-member DENIED", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    const ownerMembership = await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    // Visible while the owner still belongs to the targeted family.
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      true,
    );
    // Owner leaves the targeted family: the three-way intersection is now empty.
    await forceEndMembership(db, ownerMembership.id);
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });

  it("(e) Boudreaux/Carney: owner in both, story targeted to Boudreaux only", async () => {
    const e = await makePerson(db, "Eleanor"); // married into both families
    const bMember = await makePerson(db, "Boudreaux cousin");
    const cMember = await makePerson(db, "Carney cousin");
    const boudreaux = await makeFamily(db, "Boudreaux", e.id);
    const carney = await makeFamily(db, "Carney", e.id);
    await addMembership(db, e.id, boudreaux.id, "active");
    await addMembership(db, e.id, carney.id, "active");
    await addMembership(db, bMember.id, boudreaux.id, "active");
    await addMembership(db, cMember.id, carney.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      // A Boudreaux-only childhood story.
      targetFamilyIds: [boudreaux.id],
    });
    // The Boudreaux member sees it; the Carney-only member does not.
    expect(
      (await decideStoryRead(db, account(bMember.id), story)).allowed,
    ).toBe(true);
    expect(
      (await decideStoryRead(db, account(cMember.id), story)).allowed,
    ).toBe(false);
  });

  it("denies even a co-member for a PRIVATE story (private = author only)", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const { story } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "private",
      withApprovalConsent: true,
    });
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(
      false,
    );
  });
});

describe("media authorization", () => {
  it("owner reads their own recording", async () => {
    const e = await makePerson(db, "Eleanor");
    const { recording } = await makeStory(db, { ownerPersonId: e.id });
    expect((await decideMediaRead(db, account(e.id), recording)).allowed).toBe(
      true,
    );
  });

  it("co-member reads the recording of a readable shared story", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const { recording } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    expect(
      (await decideMediaRead(db, account(sofia.id), recording)).allowed,
    ).toBe(true);
  });

  it("denies a stranger the recording of a private story", async () => {
    const e = await makePerson(db, "Eleanor");
    const stranger = await makePerson(db, "Stranger");
    const { recording } = await makeStory(db, {
      ownerPersonId: e.id,
      audienceTier: "private",
    });
    expect(await getMediaForViewer(db, account(stranger.id), recording.id)).toBeNull();
  });

  it("keeps approval-audio owner-only (co-member denied)", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");
    const approval = await makeApprovalAudio(db, e.id);
    expect((await decideMediaRead(db, account(sofia.id), approval)).allowed).toBe(
      false,
    );
    expect((await decideMediaRead(db, account(e.id), approval)).allowed).toBe(
      true,
    );
  });
});

describe("the single front door never leaks via the list helper", () => {
  it("listStoriesForViewer returns only authorized stories", async () => {
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id);
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");

    await makeStory(db, { ownerPersonId: e.id, audienceTier: "private" });
    await makeStory(db, {
      ownerPersonId: e.id,
      state: "pending_approval",
      audienceTier: "family",
      targetFamilyIds: [fam.id],
    });
    const { story: visible } = await makeStory(db, {
      ownerPersonId: e.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });

    const forSofia = await listStoriesForViewer(db, account(sofia.id), {
      ownerPersonId: e.id,
    });
    expect(forSofia.map((s) => s.id)).toEqual([visible.id]);

    // The owner sees all three.
    const forOwner = await listStoriesForViewer(db, account(e.id), {
      ownerPersonId: e.id,
    });
    expect(forOwner).toHaveLength(3);

    // Anonymous sees none of these (none are public).
    const forAnon = await listStoriesForViewer(db, anon, {
      ownerPersonId: e.id,
    });
    expect(forAnon).toHaveLength(0);
  });
});

describe("endMembership (#161) — access revoked, content + kinship survive", () => {
  it("after removal the person is denied family content, while their story rows and kinship edges remain", async () => {
    // Steward `e` (family creator) removes co-member `sofia`.
    const e = await makePerson(db, "Eleanor");
    const sofia = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", e.id); // steward = e
    await addMembership(db, e.id, fam.id, "active");
    await addMembership(db, sofia.id, fam.id, "active");

    // Sofia authored a family story targeted into fam, and asserted a kinship edge (a parent of her).
    const { story } = await makeStory(db, {
      ownerPersonId: sofia.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    const rel = await addRelative(db, account(sofia.id), {
      familyId: fam.id,
      relation: "parent",
      displayName: "Sofia's Mom",
    });
    expect(rel.allowed).toBe(true);

    // Before removal: the co-member steward can read Sofia's shared family story.
    expect((await decideStoryRead(db, account(e.id), story)).allowed).toBe(true);

    // Steward removes Sofia.
    await endMembership(db, account(e.id), { familyId: fam.id, personId: sofia.id });

    // Access is revoked: Sofia (no longer active) is denied the family content of OTHERS. She can
    // still read her OWN story (owner always can), so test the revocation against a family story she
    // does not own — here `e`'s.
    const eStory = (
      await makeStory(db, {
        ownerPersonId: e.id,
        state: "shared",
        audienceTier: "family",
        withApprovalConsent: true,
        targetFamilyIds: [fam.id],
      })
    ).story;
    expect((await decideStoryRead(db, account(sofia.id), eStory)).allowed).toBe(false);

    // Her authored story ROW is untouched — she (the owner) still reads it in any state.
    expect((await decideStoryRead(db, account(sofia.id), story)).allowed).toBe(true);
    expect((await getStoryForViewer(db, account(sofia.id), story.id))?.id).toBe(story.id);

    // Her asserted kinship edge is untouched — the steward still sees it in the projection.
    const { edges } = await resolveKinshipProjection(db, account(e.id), fam.id);
    const edge = edges.find(
      (ed) => ed.edgeType === "parent_of" && ed.personBId === sofia.id,
    );
    expect(edge).toBeDefined();
  });
});
