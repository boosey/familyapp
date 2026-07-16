/**
 * Server-action test for "Ask a follow-up" on a published story (#77).
 *
 * `askFollowUpAction` routes a viewer's follow-up into the EXISTING ask queue via `createAsk`,
 * stamping `source_story_id` so the ask is linked to the story. This drives the REAL action against a
 * PGlite runtime (mirroring capture-subject-photo.server.test.ts's harness: `@/lib/runtime` is mocked
 * so importing the action doesn't boot the DEV runtime; getRuntime() reads settable bindings).
 *
 * Asserts: (a) an authorized co-member's follow-up creates a queued ask linked to the story +
 * narrator, surfacing via the existing narrator queue; (b) an unauthorized viewer (no shared family /
 * cannot see the story) is blocked and NO ask is written.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    auth: { getCurrentAuthContext: async () => authCtx },
  }),
}));

// `revalidatePath` needs Next's static-generation store, absent in a plain vitest run — stub it. The
// action's cache revalidation is a side effect irrelevant to the linkage/authorization assertions.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { createTestDatabase, type Database } from "@chronicle/db";
import { asks, families, memberships, persons } from "@chronicle/db/schema";
import {
  approveAndShareStory,
  listPendingAsksForNarrator,
  persistRecordingAndCreateDraft,
  finishDraft,
  appendTypedTakeContribution,
} from "@chronicle/core";
import { askFollowUpAction } from "@/app/hub/stories/[id]/actions";
import { hub } from "@/app/_copy";
import { FOLLOW_UP_QUESTION_MAX_CHARS } from "@/lib/constants";

afterAll(() => {
  vi.restoreAllMocks();
});

async function makePerson(name: string): Promise<string> {
  const [p] = await runtimeDb
    .insert(persons)
    .values({ displayName: name, spokenName: name })
    .returning();
  return p!.id;
}

async function makeFamily(name: string, creatorId: string): Promise<string> {
  const [f] = await runtimeDb
    .insert(families)
    .values({ name, creatorPersonId: creatorId, stewardPersonId: creatorId })
    .returning();
  return f!.id;
}

async function addMember(personId: string, familyId: string): Promise<void> {
  await runtimeDb.insert(memberships).values({ personId, familyId, status: "active" });
}

/** A published (shared) story owned by `narratorId`, surfaced into `famId`, visible to co-members. */
async function makePublishedStory(narratorId: string, famId: string): Promise<string> {
  const { story } = await persistRecordingAndCreateDraft(
    runtimeDb,
    {
      ownerPersonId: narratorId,
      storageKey: `story-audio/${narratorId}`,
      contentType: "audio/webm",
      checksum: "sum",
    },
    { originatingFamilyId: famId },
  );
  // Bring the draft to pending_approval with prose, then approve+share into the family.
  await appendTypedTakeContribution(runtimeDb, {
    storyId: story.id,
    ownerPersonId: narratorId,
    text: "We drove up to the lake every July.",
    priorProse: null,
  });
  await finishDraft(runtimeDb, {
    storyId: story.id,
    ownerPersonId: narratorId,
    finalText: "We drove up to the lake every July.",
    metadata: { title: "The summer at the lake", summary: "Summers up north", tags: [] },
  });
  await approveAndShareStory(runtimeDb, {
    storyId: story.id,
    narratorPersonId: narratorId,
    audienceTier: "family",
    familyIds: [famId],
  });
  return story.id;
}

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

describe("askFollowUpAction (#77)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
  });

  it("an authorized co-member's follow-up creates a queued ask linked to the story + narrator", async () => {
    const narrator = await makePerson("Eleanor");
    const cousin = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", narrator);
    await addMember(narrator, fam);
    await addMember(cousin, fam);
    const storyId = await makePublishedStory(narrator, fam);

    authCtx = { kind: "account", personId: cousin };
    const res = await askFollowUpAction(
      fd({
        storyId,
        targetPersonId: narrator,
        questionText: "What happened to the house after that summer?",
      }),
    );
    expect(res).toBeUndefined(); // success (no { error })

    // Surfaces via the EXISTING narrator queue, linked to the source story.
    const pending = await listPendingAsksForNarrator(runtimeDb, narrator);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.ask.sourceStoryId).toBe(storyId);
    expect(pending[0]!.ask.targetPersonId).toBe(narrator);
    expect(pending[0]!.ask.askerPersonId).toBe(cousin);
    expect(pending[0]!.ask.questionText).toContain("the house");
  });

  it("blocks an unauthorized viewer (no shared family) and writes NO ask", async () => {
    const narrator = await makePerson("Eleanor");
    const fam = await makeFamily("Boudreaux", narrator);
    await addMember(narrator, fam);
    const storyId = await makePublishedStory(narrator, fam);

    const stranger = await makePerson("Stranger");
    const strangerFam = await makeFamily("Carney", stranger);
    await addMember(stranger, strangerFam);

    authCtx = { kind: "account", personId: stranger };
    const res = await askFollowUpAction(
      fd({
        storyId,
        targetPersonId: narrator,
        questionText: "Sneaky follow-up on a story I cannot see",
      }),
    );
    // S1: the client gets the GENERIC mapped copy, never the internal AuthorizationError wording.
    expect(res?.error).toBe(hub.followUp.failed);

    expect(await listPendingAsksForNarrator(runtimeDb, narrator)).toHaveLength(0);
    expect(await runtimeDb.select().from(asks)).toHaveLength(0);
  });

  it("rejects an anonymous viewer", async () => {
    authCtx = { kind: "anonymous" };
    const res = await askFollowUpAction(
      fd({ storyId: "x", targetPersonId: "y", questionText: "q" }),
    );
    expect(res?.error).toBeTruthy();
  });

  it("S2: rejects an over-length question with the mapped copy and writes NO ask", async () => {
    const narrator = await makePerson("Eleanor");
    const cousin = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", narrator);
    await addMember(narrator, fam);
    await addMember(cousin, fam);
    const storyId = await makePublishedStory(narrator, fam);

    authCtx = { kind: "account", personId: cousin };
    const res = await askFollowUpAction(
      fd({
        storyId,
        targetPersonId: narrator,
        questionText: "x".repeat(FOLLOW_UP_QUESTION_MAX_CHARS + 1),
      }),
    );
    expect(res?.error).toBe(hub.followUp.failed);
    expect(await listPendingAsksForNarrator(runtimeDb, narrator)).toHaveLength(0);
  });

  it("S2: accepts a question exactly AT the cap", async () => {
    const narrator = await makePerson("Eleanor");
    const cousin = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", narrator);
    await addMember(narrator, fam);
    await addMember(cousin, fam);
    const storyId = await makePublishedStory(narrator, fam);

    authCtx = { kind: "account", personId: cousin };
    const res = await askFollowUpAction(
      fd({
        storyId,
        targetPersonId: narrator,
        questionText: "y".repeat(FOLLOW_UP_QUESTION_MAX_CHARS),
      }),
    );
    expect(res).toBeUndefined();
    expect(await listPendingAsksForNarrator(runtimeDb, narrator)).toHaveLength(1);
  });
});
