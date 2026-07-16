/**
 * Follow-up questions on published stories (#77) — the asks-back loop extended to already-shared
 * stories. A follow-up is NOT a parallel queue: it routes through the EXISTING `createAsk` front door,
 * stamping `source_story_id` so the ask is linked to the story it sprang from and surfaces in the
 * narrator's next session via the existing `listPendingAsksForNarrator` routing.
 *
 * Authorization is the single front door: `createAsk` runs `getStoryForViewer` against the source
 * story, so only a member who can already SEE the published story may pose a follow-up on it — and a
 * follow-up never leaks the existence of a story the asker could not otherwise read.
 */
import { createTestDatabase, type Database } from "@chronicle/db";
import { asks } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AuthorizationError,
  createAsk,
  listPendingAsksForNarrator,
} from "../src/index";
import { addMembership, makeFamily, makePerson, makeStory } from "./helpers";

let db: Database;
beforeEach(async () => {
  db = await createTestDatabase();
});

/** A published (shared + approved-consent) family-tier story owned by `narrator`, surfaced into `fam`. */
async function makePublishedStory(narratorId: string, famId: string) {
  const { story } = await makeStory(db, {
    ownerPersonId: narratorId,
    state: "shared",
    audienceTier: "family",
    withApprovalConsent: true,
    targetFamilyIds: [famId],
    title: "The summer at the lake",
    prose: "We drove up every July.",
  });
  return story;
}

describe("createAsk — follow-up on a published story (#77)", () => {
  it("an authorized viewer's follow-up creates a QUEUED ask LINKED to the story + narrator", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    const story = await makePublishedStory(narrator.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        questionText: "What happened to the house after that summer?",
        sourceStoryId: story.id,
      },
    );

    // Linked to the story, targeted at the narrator, born queued into the EXISTING pipeline.
    expect(ask.status).toBe("queued");
    expect(ask.sourceStoryId).toBe(story.id);
    expect(ask.targetPersonId).toBe(narrator.id);
    expect(ask.askerPersonId).toBe(cousin.id);

    // The row really carries the source-story link (not just the returned object).
    const [row] = await db
      .select({ sourceStoryId: asks.sourceStoryId })
      .from(asks)
      .where(eq(asks.id, ask.id));
    expect(row!.sourceStoryId).toBe(story.id);
  });

  it("the follow-up surfaces in the narrator's NEXT session via existing routing (no parallel queue)", async () => {
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    const story = await makePublishedStory(narrator.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      {
        targetPersonId: narrator.id,
        questionText: "Who taught you to swim there?",
        sourceStoryId: story.id,
      },
    );

    // The interviewer's system-actor read (the ONLY next-session queue) picks it up with the link intact.
    const pending = await listPendingAsksForNarrator(db, narrator.id);
    expect(pending.map((p) => p.ask.id)).toEqual([ask.id]);
    expect(pending[0]!.ask.sourceStoryId).toBe(story.id);
    expect(pending[0]!.askerSpokenName).toBe("Sofia");
  });

  it("REJECTS a follow-up from a viewer who cannot SEE the source story — with NO ask written", async () => {
    // A stranger who shares NO family with the narrator cannot see the published story. Even if they
    // guess its id, the front-door gate on the source story blocks the follow-up. (Co-membership would
    // also block here, but the source-story gate is the specific #77 leakage defense being asserted.)
    const narrator = await makePerson(db, "Eleanor");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    const story = await makePublishedStory(narrator.id, fam.id);

    const stranger = await makePerson(db, "Stranger");
    const strangerFam = await makeFamily(db, "Carney", stranger.id);
    await addMembership(db, stranger.id, strangerFam.id);

    await expect(
      createAsk(
        db,
        { kind: "account", personId: stranger.id },
        {
          targetPersonId: narrator.id,
          questionText: "Sneaky follow-up on a story I can't see",
          sourceStoryId: story.id,
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);

    // Nothing was written — no parallel-queue side effect, no ask row.
    expect(await listPendingAsksForNarrator(db, narrator.id)).toHaveLength(0);
    expect(await db.select().from(asks)).toHaveLength(0);
  });

  it("REJECTS a follow-up when the co-member cannot see the story because consent was NEVER given", async () => {
    // The asker IS a co-member (so the plain co-membership ask gate passes) BUT the source story is only
    // a draft (no approval consent) — so `getStoryForViewer` returns null for the non-owner. The
    // source-story front-door gate, not co-membership, is what must reject this. This is the teeth for
    // "no new content leakage": a co-member cannot pose a follow-up on a story not yet shared with them.
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);
    // A DRAFT story (not shared, no consent) — invisible to the co-member.
    const { story: draft } = await makeStory(db, {
      ownerPersonId: narrator.id,
      state: "draft",
      audienceTier: "family",
    });

    await expect(
      createAsk(
        db,
        { kind: "account", personId: cousin.id },
        {
          targetPersonId: narrator.id,
          questionText: "A follow-up on an unshared draft",
          sourceStoryId: draft.id,
        },
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await db.select().from(asks)).toHaveLength(0);
  });

  it("REGRESSION: a plain cold ask (no source story) still works and carries a null link", async () => {
    // The existing ask loop is unchanged: an ask without `sourceStoryId` behaves exactly as before.
    const narrator = await makePerson(db, "Eleanor");
    const cousin = await makePerson(db, "Sofia");
    const fam = await makeFamily(db, "Boudreaux", narrator.id);
    await addMembership(db, narrator.id, fam.id);
    await addMembership(db, cousin.id, fam.id);

    const ask = await createAsk(
      db,
      { kind: "account", personId: cousin.id },
      { targetPersonId: narrator.id, questionText: "What was your wedding day like?" },
    );

    expect(ask.status).toBe("queued");
    expect(ask.sourceStoryId).toBeNull();
    const pending = await listPendingAsksForNarrator(db, narrator.id);
    expect(pending.map((p) => p.ask.id)).toEqual([ask.id]);
    expect(pending[0]!.ask.sourceStoryId).toBeNull();
  });
});
