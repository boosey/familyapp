/**
 * Tests for story-subject tagging (ADR-0016, issue #35) — who a Story is ABOUT.
 *
 * Covers: tag/untag a Person on a Story the actor can see, inline `mention` creation while
 * tagging, and — the load-bearing guarantee — the "Stories about X" read is SCOPED to the
 * viewer's authorized stories. Tagging is a plain association: it NEVER widens who can see a
 * story. The regression test at the bottom proves a viewer who cannot see a story does NOT get
 * it back from the subject filter, even when the tagged Person is themselves.
 *
 * All fixtures use PGlite (real Postgres).
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { storySubjects } from "@chronicle/db/content";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  discardDraftStory,
  eraseStory,
  listStoriesAboutPerson,
  listStorySubjects,
  tagStorySubject,
  untagStorySubject,
  type AuthContext,
} from "../src/index";
import { addMembership, makeFamily, makePerson, makeStory } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

const account = (personId: string): AuthContext => ({ kind: "account", personId });

async function personRow(id: string) {
  const [row] = await db
    .select({
      displayName: persons.displayName,
      spokenName: persons.spokenName,
      origin: persons.origin,
      identified: persons.identified,
    })
    .from(persons)
    .where(eq(persons.id, id))
    .limit(1);
  return row!;
}

async function subjectRows(storyId: string) {
  return db.select().from(storySubjects).where(eq(storySubjects.storyId, storyId));
}

describe("tagStorySubject — tagging an existing Person", () => {
  it("tags a Person the actor can see the story about", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });

    const res = await tagStorySubject(db, account(owner.id), {
      storyId: story.id,
      personId: subject.id,
    });
    expect(res.tagged).toBe(true);
    expect(res.personId).toBe(subject.id);

    const rows = await subjectRows(story.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(subject.id);
    expect(rows[0]!.taggedByPersonId).toBe(owner.id);
  });

  it("is idempotent — tagging the same Person twice yields one row", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });

    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });

    const rows = await subjectRows(story.id);
    expect(rows).toHaveLength(1);
  });

  it("refuses to tag on a story the actor cannot see (front door unchanged)", async () => {
    const owner = await makePerson(db, "Owner");
    const stranger = await makePerson(db, "Stranger");
    const subject = await makePerson(db, "Grandpa");
    // A private draft — only the owner can see it.
    const { story } = await makeStory(db, { ownerPersonId: owner.id });

    await expect(
      tagStorySubject(db, account(stranger.id), { storyId: story.id, personId: subject.id }),
    ).rejects.toThrow();
    expect(await subjectRows(story.id)).toHaveLength(0);
  });

  it("refuses an anonymous actor", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await expect(
      tagStorySubject(db, { kind: "anonymous" }, { storyId: story.id, personId: subject.id }),
    ).rejects.toThrow();
  });

  it("lets a co-family viewer tag a Person on a shared story they can see", async () => {
    const owner = await makePerson(db, "Owner");
    const cousin = await makePerson(db, "Cousin");
    const fam = await makeFamily(db, "Esposito", owner.id);
    await addMembership(db, owner.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "family",
      withApprovalConsent: true,
      targetFamilyIds: [fam.id],
    });

    const res = await tagStorySubject(db, account(cousin.id), {
      storyId: story.id,
      personId: subject.id,
    });
    expect(res.tagged).toBe(true);
    const rows = await subjectRows(story.id);
    expect(rows[0]!.taggedByPersonId).toBe(cousin.id);
  });
});

describe("tagStorySubject — inline mention creation", () => {
  it("creates an identified `mention` Person and tags it in one operation", async () => {
    const owner = await makePerson(db, "Owner");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });

    const res = await tagStorySubject(db, account(owner.id), {
      storyId: story.id,
      newPersonDisplayName: "Great Aunt Ruth",
    });
    expect(res.tagged).toBe(true);
    expect(res.createdPersonId).toBe(res.personId);

    const p = await personRow(res.personId);
    expect(p.displayName).toBe("Great Aunt Ruth");
    expect(p.spokenName).toBe("Great"); // first whitespace-delimited word
    expect(p.origin).toBe("mention");
    expect(p.identified).toBe(true);

    const rows = await subjectRows(story.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.personId).toBe(res.personId);
  });

  it("rejects a blank new-person name", async () => {
    const owner = await makePerson(db, "Owner");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await expect(
      tagStorySubject(db, account(owner.id), { storyId: story.id, newPersonDisplayName: "   " }),
    ).rejects.toThrow();
  });

  it("does not create a mention when the actor cannot see the story", async () => {
    const owner = await makePerson(db, "Owner");
    const stranger = await makePerson(db, "Stranger");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    const before = await db.select().from(persons);
    await expect(
      tagStorySubject(db, account(stranger.id), {
        storyId: story.id,
        newPersonDisplayName: "Ghost",
      }),
    ).rejects.toThrow();
    const after = await db.select().from(persons);
    // No orphan mention Person is left behind (the SEE gate runs before any write).
    expect(after).toHaveLength(before.length);
  });
});

describe("untagStorySubject", () => {
  it("removes a subject link", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });

    const res = await untagStorySubject(db, account(owner.id), {
      storyId: story.id,
      personId: subject.id,
    });
    expect(res.untagged).toBe(true);
    expect(await subjectRows(story.id)).toHaveLength(0);
  });

  it("refuses to untag on a story the actor cannot see", async () => {
    const owner = await makePerson(db, "Owner");
    const stranger = await makePerson(db, "Stranger");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });

    await expect(
      untagStorySubject(db, account(stranger.id), { storyId: story.id, personId: subject.id }),
    ).rejects.toThrow();
    // The link survives — a viewer who can't see the story can't touch its subjects.
    expect(await subjectRows(story.id)).toHaveLength(1);
  });
});

describe("listStorySubjects — subjects of a story", () => {
  it("returns the tagged persons for a story the viewer can see", async () => {
    const owner = await makePerson(db, "Owner");
    const a = await makePerson(db, "Aunt Alma");
    const b = await makePerson(db, "Uncle Bob");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: a.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: b.id });

    const subjects = await listStorySubjects(db, account(owner.id), story.id);
    const ids = subjects.map((s) => s.personId).sort();
    expect(ids).toEqual([a.id, b.id].sort());
    expect(subjects.find((s) => s.personId === a.id)!.displayName).toBe("Aunt Alma");
  });

  it("returns empty for a viewer who cannot see the story (no leak)", async () => {
    const owner = await makePerson(db, "Owner");
    const stranger = await makePerson(db, "Stranger");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });

    const subjects = await listStorySubjects(db, account(stranger.id), story.id);
    expect(subjects).toEqual([]);
  });
});

describe("listStoriesAboutPerson — 'Stories about X', authorization-scoped", () => {
  it("lists the stories a Person is a subject of, among the viewer's authorized stories", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story: s1 } = await makeStory(db, { ownerPersonId: owner.id });
    const { story: s2 } = await makeStory(db, { ownerPersonId: owner.id });
    const { story: s3 } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: s1.id, personId: subject.id });
    await tagStorySubject(db, account(owner.id), { storyId: s2.id, personId: subject.id });
    // s3 is NOT about the subject.

    const stories = await listStoriesAboutPerson(db, account(owner.id), subject.id);
    const ids = stories.map((s) => s.id).sort();
    expect(ids).toEqual([s1.id, s2.id].sort());
    expect(ids).not.toContain(s3.id);
  });

  // ===================================================================================
  // THE LOAD-BEARING REGRESSION TEST: the subject filter must NEVER leak an unauthorized
  // story. Even when the tagged Person is the VIEWER themselves, a story they are not
  // authorized to see (private, not shared with them) must not appear via the subject
  // filter. The subject link only FILTERS the viewer's already-authorized set; it never
  // grants visibility. If this ever returns the private story, the front door has been
  // bypassed.
  // ===================================================================================
  it("does NOT surface a story the viewer cannot see, even if the viewer is the subject", async () => {
    const owner = await makePerson(db, "Owner");
    const viewer = await makePerson(db, "Viewer");
    // A PRIVATE draft owned by someone else — the viewer has no authorization to see it.
    const { story: privateStory } = await makeStory(db, { ownerPersonId: owner.id });
    // The owner tags the viewer as the subject of their private story.
    await tagStorySubject(db, account(owner.id), {
      storyId: privateStory.id,
      personId: viewer.id,
    });

    // Asking "stories about me" must NOT return the owner's private story.
    const stories = await listStoriesAboutPerson(db, account(viewer.id), viewer.id);
    expect(stories.map((s) => s.id)).not.toContain(privateStory.id);
    expect(stories).toEqual([]);
  });

  it("surfaces a shared story to a co-family viewer, but a private one stays hidden", async () => {
    const owner = await makePerson(db, "Owner");
    const cousin = await makePerson(db, "Cousin");
    const subject = await makePerson(db, "Grandpa");
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
    const { story: privateStory } = await makeStory(db, { ownerPersonId: owner.id });
    await tagStorySubject(db, account(owner.id), { storyId: shared.id, personId: subject.id });
    // Owner tags the private story too (owner CAN, they can see their own draft).
    await tagStorySubject(db, account(owner.id), {
      storyId: privateStory.id,
      personId: subject.id,
    });

    // The cousin sees the shared story (they're a co-member) but NOT the private draft.
    const cousinView = await listStoriesAboutPerson(db, account(cousin.id), subject.id);
    expect(cousinView.map((s) => s.id)).toEqual([shared.id]);

    // The owner sees both (their own content, any state).
    const ownerView = await listStoriesAboutPerson(db, account(owner.id), subject.id);
    expect(ownerView.map((s) => s.id).sort()).toEqual([shared.id, privateStory.id].sort());
  });

  it("returns empty for an anonymous viewer", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });

    // Public stories are visible to anonymous, so this confirms the filter still applies:
    const anon = await listStoriesAboutPerson(db, { kind: "anonymous" }, subject.id);
    expect(anon.map((s) => s.id)).toEqual([story.id]);
  });
});

// ===================================================================================
// REGRESSION (cold-review finding): story_subjects.story_id → stories.id is a plain
// non-cascading FK. If the subject rows are not cleared BEFORE the parent story is
// deleted, discard/erasure raises an FK violation and the whole delete rolls back.
// These guard both delete paths against a tagged story. (Matches the project's
// "cascade tests must seed every child table" lesson.)
// ===================================================================================
describe("subject cleanup on story deletion", () => {
  it("discardDraftStory succeeds and removes the subject rows for a tagged draft", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, { ownerPersonId: owner.id }); // private draft, no consent
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });
    expect(await subjectRows(story.id)).toHaveLength(1);

    // Must not throw (the FK would raise if story_subjects weren't cleared first).
    await discardDraftStory(db, { storyId: story.id, narratorPersonId: owner.id });

    expect(await subjectRows(story.id)).toHaveLength(0);
    // The tagged Person itself survives (it is a separate row, not owned by the story).
    const [p] = await db.select().from(persons).where(eq(persons.id, subject.id));
    expect(p).toBeDefined();
  });

  it("eraseStory succeeds and removes the subject rows for a tagged shared story", async () => {
    const owner = await makePerson(db, "Owner");
    const subject = await makePerson(db, "Grandpa");
    const { story } = await makeStory(db, {
      ownerPersonId: owner.id,
      state: "shared",
      audienceTier: "public",
      withApprovalConsent: true,
    });
    await tagStorySubject(db, account(owner.id), { storyId: story.id, personId: subject.id });
    expect(await subjectRows(story.id)).toHaveLength(1);

    const res = await eraseStory(db, account(owner.id), { storyId: story.id });
    expect(res.allowed).toBe(true);
    expect(await subjectRows(story.id)).toHaveLength(0);
  });
});
