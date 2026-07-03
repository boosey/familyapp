/**
 * Server-side integration test for `composeStoryAction` (Task 7, ADR-0007).
 *
 * `composeStoryAction` generalizes `recordAnswerAction`: it accepts EITHER an `audio` Blob (voice
 * path — delegates to the existing, well-tested `recordAnswerAction`) OR a `text` string (typed
 * telling → `ingestTextStory` + `dispatchPipeline`). `askId` is OPTIONAL — a self-initiated telling
 * has no ask to validate.
 *
 * The harness mirrors `answer-follow-up-loop.server.test.ts`: `@/lib/runtime` is mocked so importing
 * the actions module doesn't boot the real DEV runtime; getRuntime() reads settable module-level
 * bindings. Unlike the follow-up test, `dispatchPipeline` here is a REAL in-process pipeline so a
 * text draft actually renders to `pending_approval` (the text path skips transcribe → render_story).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeTranscriber: Transcriber;
let runtimeEvaluator: FollowUpEvaluator;
let runtimeDispatch: (storyId: string) => Promise<void>;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    transcriber: runtimeTranscriber,
    dispatchPipeline: (storyId: string) => runtimeDispatch(storyId),
  }),
}));

import { createTestDatabase, type Database, type FollowUpCandidate } from "@chronicle/db";
import { persons, asks } from "@chronicle/db/schema";
import { getStoryForViewer, type AuthContext } from "@chronicle/core";
import { ScriptedFollowUpEvaluator, type FollowUpEvaluator } from "@chronicle/interviewer";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  createPipeline,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { sql } from "drizzle-orm";
import { hub } from "@/app/_copy";
import { composeStoryAction, recordAnswerAction } from "@/app/hub/answer/[askId]/actions";

// Valid render output for the render_story stage (responseFormat: "json").
const RENDER_JSON = JSON.stringify({
  prose: "A polished memory, typed by the narrator.",
  title: "A Typed Memory",
  summary: "A memory the narrator wrote down.",
  tags: ["childhood"],
});

// Renders JSON for the render_story/stitch stages; returns `phrasedLine` for the follow-up phraser
// (text requests). Text-path tests only hit the json branch.
function scriptedLlm(phrasedLine = "unused"): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : phrasedLine),
  });
}

// A neutral, above-word-floor answer (16 words) — not thin, not distressed, no off-ramp — so the
// strong candidate is selected (mirrors answer-follow-up-loop.server.test.ts's ANSWER).
const NEUTRAL_ANSWER =
  "It had a beautiful stained glass window in the front hall that my grandmother truly loved.";

const STRONG_CANDIDATE: FollowUpCandidate = {
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
};

async function seedAnswerableAsk(
  db: Database,
  targetPersonId: string,
  questionText: string,
): Promise<string> {
  const [asker] = await db
    .insert(persons)
    .values({ displayName: "Asker", spokenName: "Asker" })
    .returning();
  const [ask] = await db
    .insert(asks)
    .values({ askerPersonId: asker!.id, targetPersonId, questionText, status: "queued" })
    .returning();
  return ask!.id;
}

function ownerCtx(personId: string): AuthContext {
  return { kind: "account", personId };
}

function form(entries: Record<string, string | Blob>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (v instanceof Blob) fd.append(k, v, "recording.webm");
    else fd.append(k, v);
  }
  return fd;
}

async function makePerson(db: Database, name = "Eleanor"): Promise<string> {
  const [p] = await db.insert(persons).values({ displayName: name, spokenName: name }).returning();
  return p!.id;
}

async function rowCount(db: Database, table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  const rows = (result as unknown as { rows: Array<{ n: number }> }).rows;
  return rows[0]?.n ?? 0;
}

describe("composeStoryAction — text path (Task 7)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm();
    runtimeEvaluator = new ScriptedFollowUpEvaluator([]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "unused" });
    runtimeDispatch = async (storyId: string) => {
      // A REAL in-process pipeline: the text story routes straight to render_story (skips
      // transcribe) and reaches pending_approval — exactly what dev/CI dispatch does.
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

  it("(a) a text telling with NO askId creates a kind='text' story at pending_approval", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const result = await composeStoryAction(
      form({ text: "The summer we drove to the coast and the car broke down." }),
    );

    if (!("kind" in result) || result.kind !== "ready") {
      throw new Error(`expected a ready step, got ${JSON.stringify(result)}`);
    }
    const storyId = result.storyId;

    const story = await getStoryForViewer(runtimeDb, ownerCtx(personId), storyId);
    expect(story).not.toBeNull();
    expect(story!.kind).toBe("text");
    expect(story!.ownerPersonId).toBe(personId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.transcript).toBe("The summer we drove to the coast and the car broke down.");
    expect(story!.recordingMediaId).toBeNull();
    // No audio bytes on the text path → no media row.
    expect(await rowCount(runtimeDb, "media")).toBe(0);
  });

  it("(b) an empty/whitespace text returns { error } and writes nothing", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };

    const result = await composeStoryAction(form({ text: "   \n  " }));

    expect(result).toEqual({ error: hub.actions.invalidInput });
    expect(await rowCount(runtimeDb, "stories")).toBe(0);
  });

  it("rejects an unauthenticated caller", async () => {
    authCtx = { kind: "none" };
    const result = await composeStoryAction(form({ text: "A memory." }));
    expect(result).toEqual({ error: hub.actions.notSignedIn });
  });
});

/**
 * Direct regression for the crux of Task 7: the follow-up prompt is seeded from the ask's
 * `questionText`, which now flows through the newly-EXTRACTED `assertAnswerableAsk`. No other test
 * drives the REAL `recordAnswerAction` with a real ask (the follow-up server test enters at
 * `runFollowUpStep`; the `.tsx` tests mock the action). This locks that the extraction still returns
 * the correct `questionText` AND that it reaches the evaluator's `promptText` seed — and that the
 * `{ askId }` spread reaches ingest, binding the draft to the ask.
 */
describe("recordAnswerAction — real ask, flag ON (follow-up prompt-seed regression)", () => {
  beforeEach(() => {
    // Match how answer-follow-up-loop.server.test.ts enables the follow-up policy.
    process.env.FOLLOW_UPS_ENABLED = "1";
  });
  afterAll(() => {
    delete process.env.FOLLOW_UPS_ENABLED;
  });

  it("seeds the follow-up prompt from the ask questionText and binds askId onto the draft", async () => {
    const personId = await makePerson(runtimeDb);
    authCtx = { kind: "account", personId };
    const QUESTION = "What was your childhood home like?";
    const askId = await seedAnswerableAsk(runtimeDb, personId, QUESTION);

    const evaluator = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]);
    runtimeEvaluator = evaluator;
    runtimeLlm = scriptedLlm("Tell me more about that stained glass window.");
    runtimeTranscriber = new ScriptedTranscriber({ text: NEUTRAL_ANSWER });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    // With-ask branch under flag ON ENTERED the follow-up loop (follow_up, not ready).
    if (!("kind" in result) || result.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(result)}`);
    }
    expect(result.prompt).toBe("Tell me more about that stained glass window.");

    // CRUX: the ask questionText (returned by the extracted assertAnswerableAsk) reached the
    // evaluator's promptText seed — the whole point of this task's refactor.
    expect(evaluator.calls).toHaveLength(1);
    expect(evaluator.calls[0]!.promptText).toBe(QUESTION);

    // The { askId } spread reached ingestRecording → the draft is bound to the ask. Read ask_id
    // via raw SQL (the front-door view doesn't project it); confirm the story is voice-origin.
    const res = await runtimeDb.execute(
      sql`select ask_id, kind from stories where id = ${result.storyId}`,
    );
    const row = (res as unknown as { rows: Array<{ ask_id: string; kind: string }> }).rows[0];
    expect(row?.ask_id).toBe(askId);
    expect(row?.kind).toBe("voice");
  });
});
