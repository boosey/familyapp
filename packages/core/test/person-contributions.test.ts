/**
 * Tests for the tree Slice B "contribution destinations" reads:
 *   - `listStoriesNarratedByPerson` — the stories a Person OWNS/narrated, authorization-scoped.
 *   - `listPhotosContributedByPerson` — the album photos a Person contributed, membership-scoped.
 *
 * The load-bearing guarantee for BOTH is "narrows, never grants": the contributor/owner filter
 * only ever FILTERS the viewer's already-authorized set. A story/photo the viewer could not
 * otherwise see never appears just because this person is the owner/contributor. The regression
 * tests seed a cross-family story AND a cross-family photo the viewer may NOT see and assert they
 * are EXCLUDED — if either ever returns them, the front door has been bypassed.
 *
 * All fixtures use PGlite (real Postgres).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAlbumPhoto,
  listPhotosContributedByPerson,
  listStoriesNarratedByPerson,
  type AuthContext,
} from "../src/index";
import { addMembership, makeFamily, makePerson, makeStory } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function seedPhoto(
  contributorPersonId: string,
  familyIds: string[],
  caption: string | null = null,
) {
  return createAlbumPhoto(db, {
    contributorPersonId,
    familyIds,
    source: "upload",
    storageKey: `family-photos/${Math.random()}`,
    caption,
  });
}

describe("listStoriesNarratedByPerson — 'Stories contributed', authorization-scoped", () => {
  it("lists the stories a Person OWNS, among the viewer's authorized stories", async () => {
    const owner = await makePerson(db, "Owner");
    const other = await makePerson(db, "Other narrator");
    const { story: s1 } = await makeStory(db, { ownerPersonId: owner.id });
    const { story: s2 } = await makeStory(db, { ownerPersonId: owner.id });
    // A story owned by someone ELSE must never appear when asking for `owner`'s contributions.
    const { story: s3 } = await makeStory(db, { ownerPersonId: other.id });

    const stories = await listStoriesNarratedByPerson(db, account(owner.id), owner.id);
    const ids = stories.map((s) => s.id).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());
    expect(ids).not.toContain(s3.id);
  });

  it("orders newest-first (COALESCE(approvedAt, createdAt) DESC)", async () => {
    const owner = await makePerson(db, "Owner");
    const { story: s1 } = await makeStory(db, { ownerPersonId: owner.id });
    const { story: s2 } = await makeStory(db, { ownerPersonId: owner.id });
    const stories = await listStoriesNarratedByPerson(db, account(owner.id), owner.id);
    // s2 was created after s1, so it sorts first.
    expect(stories.map((s) => s.id)).toEqual([s2.id, s1.id]);
  });

  // ===================================================================================
  // THE LOAD-BEARING REGRESSION TEST: the owner filter must NEVER leak an unauthorized
  // story. A viewer asking for another person's contributions only sees the SHARED ones
  // they were already entitled to — a private draft the owner never shared stays hidden.
  // ===================================================================================
  it("does NOT surface a private story the viewer cannot see (narrows, never grants)", async () => {
    const owner = await makePerson(db, "Owner");
    const cousin = await makePerson(db, "Cousin");
    const fam = await makeFamily(db, "Esposito", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const { story: shared } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });
    // A private draft owned by `owner` — the cousin has NO authorization to see it.
    const { story: privateStory } = await makeStory(db, { ownerPersonId: owner.id });

    // The cousin sees only the shared story, never the private draft.
    const cousinView = await listStoriesNarratedByPerson(db, account(cousin.id), owner.id);
    expect(cousinView.map((s) => s.id)).toEqual([shared.id]);
    expect(cousinView.map((s) => s.id)).not.toContain(privateStory.id);

    // The owner sees both (their own content, any state).
    const ownerView = await listStoriesNarratedByPerson(db, account(owner.id), owner.id);
    expect(ownerView.map((s) => s.id).sort()).toEqual([shared.id, privateStory.id].sort());
  });

  it("returns [] for an anonymous viewer against a private owner's drafts", async () => {
    const owner = await makePerson(db, "Owner");
    await makeStory(db, { ownerPersonId: owner.id });
    const anon = await listStoriesNarratedByPerson(db, { kind: "anonymous" }, owner.id);
    expect(anon).toEqual([]);
  });

  it("surfaces a public story owned by the person to an anonymous viewer", async () => {
    const owner = await makePerson(db, "Owner");
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    const anon = await listStoriesNarratedByPerson(db, { kind: "anonymous" }, owner.id);
    expect(anon.map((s) => s.id)).toEqual([story.id]);
  });
});

describe("listPhotosContributedByPerson — 'Photos contributed', membership-scoped", () => {
  it("lists photos a Person contributed to a family the viewer shares", async () => {
    const contributor = await makePerson(db, "Contributor");
    const cousin = await makePerson(db, "Cousin");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const p1 = await seedPhoto(contributor.id, [fam.id], "Wedding");
    const p2 = await seedPhoto(contributor.id, [fam.id], "Reunion");
    // A photo contributed by someone else — excluded.
    const p3 = await seedPhoto(cousin.id, [fam.id], "Not theirs");

    const photos = await listPhotosContributedByPerson(db, account(cousin.id), contributor.id);
    const ids = photos.map((p) => p.id).sort();
    expect(ids).toEqual([p1.id, p2.id].sort());
    expect(ids).not.toContain(p3.id);
    // `families` reflects the authorized placement.
    expect(photos[0]!.families.map((f) => f.familyId)).toEqual([fam.id]);
  });

  it("orders newest-first (createdAt DESC)", async () => {
    const contributor = await makePerson(db, "Contributor");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id);
    const p1 = await seedPhoto(contributor.id, [fam.id]);
    const p2 = await seedPhoto(contributor.id, [fam.id]);
    const photos = await listPhotosContributedByPerson(db, account(contributor.id), contributor.id);
    expect(photos.map((p) => p.id)).toEqual([p2.id, p1.id]);
  });

  // ===================================================================================
  // THE LOAD-BEARING REGRESSION TEST: a photo the contributor placed ONLY in a family the
  // viewer isn't in must NOT appear. The contributor filter narrows the viewer's authorized
  // albums; it never grants. (Also proves there is no contributor-bypass leaking a photo to
  // a third-party viewer who shares no album with it.)
  // ===================================================================================
  it("does NOT surface a cross-family photo the viewer cannot see (narrows, never grants)", async () => {
    const contributor = await makePerson(db, "Contributor");
    const cousin = await makePerson(db, "Cousin");
    // The two live in DIFFERENT families.
    const shared = await makeFamily(db, "Shared", contributor.id);
    const secret = await makeFamily(db, "Secret", contributor.id);
    await addMembership(db, contributor.id, shared.id);
    await addMembership(db, contributor.id, secret.id);
    await addMembership(db, cousin.id, shared.id);
    // cousin is NOT a member of `secret`.

    const visible = await seedPhoto(contributor.id, [shared.id], "In shared album");
    const hidden = await seedPhoto(contributor.id, [secret.id], "In secret album");

    const cousinView = await listPhotosContributedByPerson(db, account(cousin.id), contributor.id);
    expect(cousinView.map((p) => p.id)).toEqual([visible.id]);
    expect(cousinView.map((p) => p.id)).not.toContain(hidden.id);

    // The contributor themselves (member of both) sees both.
    const selfView = await listPhotosContributedByPerson(
      db,
      account(contributor.id),
      contributor.id,
    );
    expect(selfView.map((p) => p.id).sort()).toEqual([visible.id, hidden.id].sort());
  });

  it("does not leak a family placement the viewer isn't in on a multi-placed photo", async () => {
    const contributor = await makePerson(db, "Contributor");
    const cousin = await makePerson(db, "Cousin");
    const shared = await makeFamily(db, "Shared", contributor.id);
    const secret = await makeFamily(db, "Secret", contributor.id);
    await addMembership(db, contributor.id, shared.id);
    await addMembership(db, contributor.id, secret.id);
    await addMembership(db, cousin.id, shared.id);

    // ONE photo placed in BOTH families.
    const photo = await seedPhoto(contributor.id, [shared.id, secret.id], "Both");

    const cousinView = await listPhotosContributedByPerson(db, account(cousin.id), contributor.id);
    expect(cousinView.map((p) => p.id)).toEqual([photo.id]);
    // `families` shows ONLY the shared album, never the secret one the cousin isn't in.
    expect(cousinView[0]!.families.map((f) => f.familyId)).toEqual([shared.id]);
  });

  it("returns [] for an anonymous viewer", async () => {
    const contributor = await makePerson(db, "Contributor");
    const fam = await makeFamily(db, "Esposito", contributor.id);
    await addMembership(db, contributor.id, fam.id);
    await seedPhoto(contributor.id, [fam.id]);
    const anon = await listPhotosContributedByPerson(db, { kind: "anonymous" }, contributor.id);
    expect(anon).toEqual([]);
  });
});
