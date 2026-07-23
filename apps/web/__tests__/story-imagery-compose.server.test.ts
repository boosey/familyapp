/**
 * Server-side integration tests for ADR-0009 Phase 3 "subject photo" on the in-hub telling surface
 * (Slice B, contract item 5). Two web behaviours are proven end-to-end against a REAL PGlite DB and
 * the REAL core write path (no core mocks):
 *
 *   1. Tell-a-photo: `composeStoryAction` carries a client `subjectPhotoId` onto the new story — the
 *      photo becomes the story's SUBJECT and its FIRST `story_images` cover row. The client id is a
 *      HINT only; the core write gate (run against the SERVER-resolved owner) is the authority, so an
 *      unseeable id makes ingest throw → the action returns `{ error }` and writes NO story.
 *   2. Ask carry-forward: answering an ask that has 2+ subject photos yields a new story whose subject
 *      is the FIRST ask photo and whose remaining ask photos ride along as accompaniment images.
 *
 * The ask-creation gate itself (a photo the target can't see is rejected) is proven at the core layer
 * in `packages/core/test/asks.test.ts`; the AskTab `submitAsk` handler is an inline, non-exported
 * server action that redirects, so it isn't independently unit-testable — item 4's happy path is
 * exercised here through `createAsk` (the exact function `submitAsk` wraps) writing `ask_subject_photos`
 * rows, and item 5's reject path lives in the core suite (see report).
 *
 * Harness mirrors compose-story-action.server.test.ts: `@/lib/runtime` is mocked so importing the
 * actions module doesn't boot the DEV runtime; getRuntime() reads settable module-level bindings, and
 * `dispatchPipeline` is a REAL in-process pipeline so a text draft renders to pending_approval.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeTranscriber: Transcriber;
let runtimeDispatch: (storyId: string) => Promise<void>;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: undefined,
    transcriber: runtimeTranscriber,
    dispatchPipeline: (storyId: string) => runtimeDispatch(storyId),
  }),
}));

import { createTestDatabase, type Database } from "@chronicle/db";
import { families, memberships, persons } from "@chronicle/db/schema";
import { stories } from "@chronicle/db/content";
import {
  createAsk,
  createAlbumPhoto,
  listStoryImages,
  listAskSubjectPhotos,
  type AuthContext,
} from "@chronicle/core";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  createPipeline,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { eq } from "drizzle-orm";
import { hub } from "@/app/_copy";
import { composeStoryAction } from "@/app/hub/answer/[askId]/actions";

// Valid render output for the render_story stage (responseFormat: "json").
const RENDER_JSON = JSON.stringify({
  prose: "A polished memory, typed by the narrator.",
  title: "A Typed Memory",
  summary: "A memory the narrator wrote down.",
  tags: ["childhood"],
});

function scriptedLlm(): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : "unused"),
  });
}

const account = (personId: string): AuthContext => ({ kind: "account", personId });

function form(entries: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v instanceof Blob) fd.append(k, v, "recording.webm");
    else fd.append(k, v);
  }
  return fd;
}

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

async function makePhoto(contributorId: string, familyId: string): Promise<string> {
  const photo = await createAlbumPhoto(runtimeDb, {
    contributorPersonId: contributorId,
    familyIds: [familyId],
    source: "upload",
    storageKey: `family-photos/${crypto.randomUUID()}`,
  });
  return photo.id;
}

async function subjectPhotoIdOf(storyId: string): Promise<string | null> {
  const [row] = await runtimeDb
    .select({ subjectPhotoId: stories.subjectPhotoId })
    .from(stories)
    .where(eq(stories.id, storyId));
  return row?.subjectPhotoId ?? null;
}

async function storyCount(): Promise<number> {
  const rows = await runtimeDb.select({ id: stories.id }).from(stories);
  return rows.length;
}

beforeEach(async () => {
  runtimeDb = await createTestDatabase();
  runtimeStorage = new InMemoryMediaStorage();
  runtimeLlm = scriptedLlm();
  runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
  runtimeDispatch = async (storyId: string) => {
    const pipeline = createPipeline({
      db: runtimeDb,
      storage: runtimeStorage,
      transcriber: runtimeTranscriber,
      languageModel: runtimeLlm,
    });
    await pipeline.start(storyId);
    await pipeline.runToCompletion();
  };
  authCtx = { kind: "none" };
});
afterAll(() => {});

describe("composeStoryAction — tell-a-photo subject (ADR-0009 Phase 3)", () => {
  it("(1) carries a visible subjectPhotoId onto the story as subject + first cover image", async () => {
    const owner = await makePerson("Rosa");
    const fam = await makeFamily("Esposito", owner);
    await addMember(owner, fam);
    const photo = await makePhoto(owner, fam);
    authCtx = account(owner);

    const result = await composeStoryAction(
      // Dated (stated year) so the always-on temporal probe is N/A and no follow-up evaluator is
      // wired (mock: followUpEvaluator undefined) → the result stays `appended` for this imagery test.
      form({ text: "In 1962, the porch swing my father built.", subjectPhotoId: photo }),
    );
    // ADR-0014 Inc 3: composeStoryAction's text path now returns `appended` (per-take model), not the
    // retired `ready` poll step. The imagery assertions below are unchanged.
    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }

    // The story row carries the thin "about" pointer...
    expect(await subjectPhotoIdOf(result.storyId)).toBe(photo);
    // ...and the same photo is the story's FIRST cover image (atomic at creation).
    const images = await listStoryImages(runtimeDb, result.storyId);
    expect(images).toHaveLength(1);
    expect(images[0]!.familyPhotoId).toBe(photo);
    expect(images[0]!.isCover).toBe(true);
    expect(images[0]!.position).toBe(0);
  });

  it("(2) REJECTS a subjectPhotoId the owner cannot see and writes NO story", async () => {
    const owner = await makePerson("Rosa");
    const ownFam = await makeFamily("Esposito", owner);
    await addMember(owner, ownFam);
    // A photo in a family the owner is NOT a member of — the client hint is unseeable to the owner.
    const stranger = await makePerson("Mallory");
    const otherFam = await makeFamily("Carney", stranger);
    await addMember(stranger, otherFam);
    const unseeable = await makePhoto(stranger, otherFam);
    authCtx = account(owner);

    const result = await composeStoryAction(
      form({ text: "I should not be able to reference this photo.", subjectPhotoId: unseeable }),
    );

    // The core write gate threw inside ingest → the action mapped it to saveFailed, tx rolled back.
    expect(result).toEqual({ error: hub.actions.saveFailed });
    expect(await storyCount()).toBe(0);
  });
});

describe("composeStoryAction — ask carry-forward (ADR-0009 Phase 3)", () => {
  it("(3) answering an ask with 2 subject photos: first is subject/cover, rest ride as accompaniment", async () => {
    // Asker and target (answerer) share a family; both can see the photos.
    const target = await makePerson("Eleanor"); // the narrator who answers
    const asker = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", target);
    await addMember(target, fam);
    await addMember(asker, fam);
    const photo1 = await makePhoto(asker, fam);
    const photo2 = await makePhoto(asker, fam);

    // The asker raises an ask ABOUT the two photos (both target-visible; gate passes).
    const ask = await createAsk(runtimeDb, account(asker), {
      targetPersonId: target,
      familyIds: [fam],
      questionText: "Tell me about these two.",
      subjectPhotoIds: [photo1, photo2],
    });
    // Sanity: both photos landed on the ask, in order.
    expect(await listAskSubjectPhotos(runtimeDb, ask.id)).toEqual([photo1, photo2]);

    // The target answers via the text path — carry-forward runs on the server (identity re-resolved).
    authCtx = account(target);
    const result = await composeStoryAction(
      // Dated so the always-on temporal probe is N/A (no follow-up evaluator wired) → stays `appended`.
      form({ askId: ask.id, text: "Those were taken in 1971, the summer we moved." }),
    );
    // ADR-0014 Inc 3: composeStoryAction's text path now returns `appended` (per-take model), not the
    // retired `ready` poll step. The imagery assertions below are unchanged.
    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }

    // The FIRST ask photo is the story's subject/cover; the rest are attached as accompaniment.
    expect(await subjectPhotoIdOf(result.storyId)).toBe(photo1);
    const images = await listStoryImages(runtimeDb, result.storyId);
    expect(images.map((i) => i.familyPhotoId)).toEqual([photo1, photo2]);
    expect(images[0]!.isCover).toBe(true); // first ask photo is the cover
    expect(images[1]!.isCover).toBe(false); // accompaniment
  });
});

describe("ask-attach happy path via the AskTab write path (createAsk)", () => {
  it("(4) attaching photos BOTH parties can see writes ask_subject_photos rows", async () => {
    // `submitAsk` (AskTab.tsx) is an inline, non-exported action that only parses FormData and
    // redirects around this exact call; we drive `createAsk` with the same account context.
    const target = await makePerson("Eleanor");
    const asker = await makePerson("Sofia");
    const fam = await makeFamily("Boudreaux", target);
    await addMember(target, fam);
    await addMember(asker, fam);
    const photo = await makePhoto(asker, fam);

    const ask = await createAsk(runtimeDb, account(asker), {
      targetPersonId: target,
      familyIds: [fam],
      questionText: "Tell the story of this photo.",
      subjectPhotoIds: [photo],
    });

    expect(ask.status).toBe("queued");
    expect(await listAskSubjectPhotos(runtimeDb, ask.id)).toEqual([photo]);
  });
});
