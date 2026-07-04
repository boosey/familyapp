/**
 * Server-side integration test for the follow-up mini-loop (Task 6b).
 *
 * It drives the EXPORTED `runFollowUpStep` directly against a hand-built runtime seam — a PGlite db
 * + a `ScriptedFollowUpEvaluator` (the propose side) + a `ScriptedLanguageModel` (phrasing + the
 * single stitch/polish) — instead of the `getRuntime()` singleton. `runFollowUpStep` is typed to
 * exactly what it uses (`db` + the two AI seams), so no full runtime is needed and nothing boots.
 *
 * `@/lib/runtime` is mocked so importing the actions module doesn't boot the real DEV runtime
 * (PGlite/server-only/Inngest) at load time — mirrors `answer-status.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// A SETTABLE test runtime (mirrors answer-status.test.ts): getRuntime() reads these module-level
// bindings at call time, so an action test assigns them in beforeEach / per-test and drives the
// real server actions without booting the DEV runtime (PGlite/server-only/Inngest).
let runtimeDb: Database;
let runtimeStorage: InMemoryMediaStorage;
let runtimeLlm: LanguageModel;
let runtimeEvaluator: FollowUpEvaluator;
let runtimeTranscriber: Transcriber;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    transcriber: runtimeTranscriber,
    dispatchPipeline: async () => {},
  }),
}));

import { createTestDatabase, type Database, type FollowUpCandidate } from "@chronicle/db";
import { persons, asks } from "@chronicle/db/schema";
import {
  persistRecordingAndCreateDraft,
  persistTakeRecording,
  appendVoiceTakeContribution,
  listStoryRecordings,
  updateStoryRecordingTranscript,
  listFollowUpDecisionsForStory,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  dropStoryRecording,
  getStoryForViewer,
  type AuthContext,
} from "@chronicle/core";
import { ScriptedFollowUpEvaluator, type FollowUpEvaluator } from "@chronicle/interviewer";
import {
  ScriptedLanguageModel,
  ScriptedTranscriber,
  stitchAndRenderStory,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { hub } from "@/app/_copy";
import {
  runFollowUpStep,
  recordAnswerAction,
  recordFollowUpTakeAction,
  finishThreadAction,
  dropTakeAction,
} from "@/app/hub/answer/[askId]/actions";

/** Seed a queued ask targeted at `targetPersonId` and return its id (for the flag-ON voice path). */
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

// A neutral, above-the-word-floor answer (16 words) — not thin, not distressed, no off-ramp.
const ANSWER =
  "It had a beautiful stained glass window in the front hall that my grandmother truly loved.";
const ANSWER_2 = "The window was made of red and blue glass that caught the morning light beautifully.";

const STRONG_CANDIDATE: FollowUpCandidate = {
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
};

// Valid render output for the stitch/polish stage (responseFormat: "json").
const RENDER_JSON = JSON.stringify({
  prose: "A polished memory about a childhood home's stained glass window.",
  title: "The Stained Glass Window",
  summary: "A memory of a childhood home.",
  tags: ["childhood"],
});

/** A LanguageModel that phrases follow-ups (text) and renders stories (json) off one instance. */
function scriptedLlm(phrasedLine: string): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : phrasedLine),
  });
}

/** A transcriber that always fails — used to exercise the mid-thread degrade guards. */
const throwingTranscriber: Transcriber = {
  async transcribe() {
    throw new Error("ASR unavailable");
  },
};

/** A language model that always fails — used to make the stitch/render step throw. */
const throwingLlm: LanguageModel = {
  async complete() {
    throw new Error("LLM unavailable");
  },
};

async function seedDraft(db: Database): Promise<{ ownerPersonId: string; storyId: string }> {
  const [owner] = await db
    .insert(persons)
    .values({ displayName: "Eleanor", spokenName: "Eleanor", birthYear: 1942 })
    .returning();
  const ownerPersonId = owner!.id;
  const persisted = await persistRecordingAndCreateDraft(
    db,
    {
      ownerPersonId,
      storageKey: `story-audio/${ownerPersonId}/t0.webm`,
      contentType: "audio/webm",
      durationSeconds: 60,
      checksum: "sha256:t0",
    },
    { promptQuestion: "What was your childhood home like?" },
  );
  return { ownerPersonId, storyId: persisted.story.id };
}

function ownerCtx(personId: string): AuthContext {
  return { kind: "account", personId };
}

describe("follow-up mini-loop — runFollowUpStep (Task 6b)", () => {
  beforeEach(() => {
    // runFollowUpStep resolves the policy itself via resolveFollowUpPolicyForRequest() → env flag.
    process.env.FOLLOW_UPS_ENABLED = "1";
  });
  afterAll(() => {
    delete process.env.FOLLOW_UPS_ENABLED;
  });

  it("proposes a follow-up and appends a decision row with the selected seed", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const rt = {
      db,
      languageModel: scriptedLlm("Tell me more about that stained glass window."),
      followUpEvaluator: new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]),
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    expect(step).toEqual({
      kind: "follow_up",
      storyId,
      prompt: "Tell me more about that stained glass window.",
    });

    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordKind).toBe("decision");
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
    expect(rows[0]!.phrasedLine).toBe("Tell me more about that stained glass window.");
    expect(rows[0]!.threadPosition).toBe(0);

    // Follow-up proposed → the story stays a draft (the thread is still open).
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("stops proposing when nothing is selected: records a null-seed decision, returns null, draft stays open (no stitch)", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    // Take 0 already transcribed (unchanged by this step — propose-only never touches transcript/prose).
    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    const rt = {
      db,
      languageModel: scriptedLlm("(unused — nothing selected)"),
      followUpEvaluator: new ScriptedFollowUpEvaluator([[]]), // no candidates → stop proposing
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    // Propose-only (slice 6): nothing selected → null (stop proposing), no stitch, no transition.
    expect(step).toBeNull();

    // The null-seed decision row is STILL written (fully audited).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordKind).toBe("decision");
    expect(rows[0]!.selectedSeed).toBeNull();
    expect(rows[0]!.phrasedLine).toBeNull();

    // The story STAYS draft; runFollowUpStep never stitches (no render, no prose written by it).
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBeNull();
  });

  it("append-outcome path: decision → answered outcome → second (empty) decision finalizes the thread", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    // One evaluator instance drives the whole thread: call 0 proposes, call 1 proposes nothing.
    const rt = {
      db,
      languageModel: scriptedLlm("Tell me more about that window."),
      followUpEvaluator: new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE], []]),
    };

    // Turn 0: a follow-up is proposed.
    const step1 = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });
    if (step1 === null || step1.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(step1)}`);
    }
    expect(step1.storyId).toBe(storyId);

    // The narrator answered it — attach the `answered` outcome (as recordFollowUpTakeAction does).
    const unresolved = await latestUnresolvedDecision(db, storyId);
    expect(unresolved).not.toBeNull();
    await appendFollowUpOutcome(db, {
      storyId,
      decisionId: unresolved!.id,
      threadPosition: unresolved!.threadPosition,
      outcome: "answered",
    });

    // Turn 1: evaluator proposes nothing → stop proposing (null), draft stays open.
    const step2 = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: unresolved!.phrasedLine ?? "",
      answerTranscript: ANSWER_2,
    });
    expect(step2).toBeNull();

    // The ledger reads decision → outcome → decision (append-only, in order).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows.map((r) => r.recordKind)).toEqual(["decision", "outcome", "decision"]);
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
    expect(rows[1]!.outcome).toBe("answered");
    expect(rows[2]!.selectedSeed).toBeNull();
    expect(rows[2]!.threadPosition).toBe(1);

    // The story STAYS draft — propose-only never transitions it.
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("drop → re-stitch: dropping a follow-up take pre-approval re-stitches to the survivors", async () => {
    // Covers the core operations dropTakeAction composes (dropStoryRecording + stitchAndRenderStory).
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "Take zero survivor text.",
    });

    // Append a follow-up take (position 1) + its transcript.
    await persistTakeRecording(
      db,
      {
        ownerPersonId,
        storageKey: `story-audio/${ownerPersonId}/t1.webm`,
        contentType: "audio/webm",
        durationSeconds: 30,
        checksum: "sha256:t1",
      },
      storyId,
    );
    const takes = await listStoryRecordings(db, storyId);
    expect(takes.map((t) => t.position)).toEqual([0, 1]);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: takes[1]!.id,
      transcript: "Take one dropped text.",
    });

    // Drop the follow-up take (pre-approval, so the delete guard permits it).
    await dropStoryRecording(db, { storyId, position: 1, narratorPersonId: ownerPersonId });

    // Re-stitch: the surviving take-0 transcript is all that remains.
    const rt = { db, languageModel: new ScriptedLanguageModel() };
    await stitchAndRenderStory(rt, storyId);

    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.transcript).toBe("Take zero survivor text.");
  });

  it("degrades when the evaluator throws: stops proposing (null), draft stays open, no decision row (never blocks the draft)", async () => {
    // Headline safety (handoff watch #2): a broken evaluator must not block the narrator. Propose-only
    // now means it simply stops proposing — the take is already appended by the caller.
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);
    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    const rt = {
      db,
      languageModel: scriptedLlm("(unused)"),
      followUpEvaluator: {
        async evaluate() {
          throw new Error("evaluator down");
        },
      } as FollowUpEvaluator,
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    expect(step).toBeNull();

    // No stitch, no transition — the story stays a draft.
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");

    // The failed turn wrote NO decision row (evaluate/phrase run before appendFollowUpDecision).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(0);
  });

  it("degrades on a budget timeout: a never-resolving evaluator stops proposing (null), draft stays open", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);
    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    const rt = {
      db,
      languageModel: scriptedLlm("(unused)"),
      // evaluate never resolves → the FOLLOW_UP_BUDGET_MS race rejects → degrade path.
      followUpEvaluator: {
        evaluate: () => new Promise<never>(() => {}),
      } as unknown as FollowUpEvaluator,
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    expect(step).toBeNull();
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  }, 15000);
});

/**
 * Action-level tests: drive the real server actions through the mocked getRuntime seam (settable
 * `runtime*` bindings above). These cover the front-door IDOR check and the mid-thread degrade
 * guards (handoff watch #2 — a hiccup must never 500 the narrator).
 */
describe("follow-up actions (getRuntime-driven)", () => {
  beforeEach(async () => {
    runtimeDb = await createTestDatabase();
    runtimeStorage = new InMemoryMediaStorage();
    runtimeLlm = scriptedLlm("Tell me more.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[]]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "follow-up take words" });
    authCtx = { kind: "none" };
    process.env.FOLLOW_UPS_ENABLED = "1";
  });
  afterAll(() => {
    delete process.env.FOLLOW_UPS_ENABLED;
  });

  function form(entries: Record<string, string | Blob>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) {
      if (v instanceof Blob) fd.append(k, v, "recording.webm");
      else fd.append(k, v);
    }
    return fd;
  }

  it("dropTakeAction (position 0) discards the whole thread and deletes its blobs", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };

    // Put take-0's blob in storage at the key seedDraft used, so we can assert it is deleted.
    const key = `story-audio/${ownerPersonId}/t0.webm`;
    await runtimeStorage.put({ key, bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" });
    expect(await runtimeStorage.exists(key)).toBe(true);

    const result = await dropTakeAction(form({ storyId, position: "0" }));

    expect(result).toEqual({ kind: "discarded" });
    expect(await runtimeStorage.exists(key)).toBe(false);
    expect(await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId)).toBeNull();
  });

  it("dropTakeAction (position > 0) removes the follow-up take, deletes its blob, and re-stitches the survivors", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };

    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Surviving take.",
    });
    const key1 = `story-audio/${ownerPersonId}/t1.webm`;
    await persistTakeRecording(
      runtimeDb,
      { ownerPersonId, storageKey: key1, contentType: "audio/webm", durationSeconds: 30, checksum: "sha256:t1" },
      storyId,
    );
    const takes = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: takes[1]!.id,
      transcript: "Dropped take.",
    });
    await runtimeStorage.put({ key: key1, bytes: new Uint8Array([9]), contentType: "audio/webm" });

    const result = await dropTakeAction(form({ storyId, position: "1" }));

    expect(result).toEqual({ kind: "ready", storyId });
    expect(await runtimeStorage.exists(key1)).toBe(false);
    const remaining = await listStoryRecordings(runtimeDb, storyId);
    expect(remaining.map((t) => t.position)).toEqual([0]);
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.transcript).toBe("Surviving take.");
  });

  it("recordFollowUpTakeAction rejects a story the caller does not own (IDOR → storyNotFound)", async () => {
    const { storyId } = await seedDraft(runtimeDb); // owned by Eleanor
    const [mallory] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Mallory", spokenName: "Mallory" })
      .returning();
    authCtx = { kind: "account", personId: mallory!.id };

    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), storyId, prose: "base" }),
    );

    expect(result).toEqual({ error: hub.actions.storyNotFound });
  });

  it("recordFollowUpTakeAction returns a retryable error when transcription fails; take audio stays durable, draft stays open", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    runtimeTranscriber = throwingTranscriber; // the follow-up take's transcribe will throw

    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }), storyId, prose: "base" }),
    );

    // Slice 6: no stitch-to-finish. The transcribe failure returns a retryable error; the story
    // stays `draft` so the narrator can retry.
    expect(result).toEqual({ error: hub.actions.saveFailed });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    // The dropped-in follow-up take was still appended before the transcribe threw (its audio is
    // durable via ingestFollowUpTake), just un-transcribed.
    const takes = await listStoryRecordings(runtimeDb, storyId);
    expect(takes.map((t) => t.position)).toEqual([0, 1]);
  });

  it("finishThreadAction rejects a non-draft/foreign story (IDOR → storyNotFound)", async () => {
    const { storyId } = await seedDraft(runtimeDb);
    const [mallory] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Mallory", spokenName: "Mallory" })
      .returning();
    authCtx = { kind: "account", personId: mallory!.id };

    const result = await finishThreadAction(form({ storyId }));
    expect(result).toEqual({ error: hub.actions.storyNotFound });
  });

  it("finishThreadAction (decline) makes NO LLM call, returns appended with the current prose, draft stays open", async () => {
    // Slice 6: decline records the skip and returns to the draft surface — no stitch, no render, no
    // transition. Wiring a throwing LLM proves finishThreadAction never calls the model.
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    // Seed some working prose so the returned `prose` is meaningful.
    await appendVoiceTakeContribution(runtimeDb, {
      storyId,
      ownerPersonId,
      storyRecordingId: take0!.id,
      rawTranscript: "Take zero words.",
      cleanedSegment: "Take zero, cleaned.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: null,
    });
    runtimeLlm = throwingLlm; // if finishThreadAction called the LLM at all, this would throw

    const result = await finishThreadAction(form({ storyId }));

    expect(result).toEqual({
      kind: "appended",
      storyId,
      prose: "Take zero, cleaned.",
      appendedSegment: "",
    });
    // No transition — the draft stays open for the narrator to keep composing / Finish later.
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("finishThreadAction appends a `skipped` outcome for an unresolved follow-up (append-only), draft stays open", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    // Create an unresolved (asked-but-unanswered) follow-up decision via the propose-only step.
    const proposeRt = {
      db: runtimeDb,
      languageModel: scriptedLlm("Tell me more about that window."),
      followUpEvaluator: new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]),
    };
    const proposed = await runFollowUpStep(proposeRt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });
    expect(proposed?.kind).toBe("follow_up");
    const unresolvedBefore = await latestUnresolvedDecision(runtimeDb, storyId);
    expect(unresolvedBefore).not.toBeNull();

    const result = await finishThreadAction(form({ storyId }));
    expect("kind" in result && result.kind).toBe("appended");

    // A `skipped` outcome row was appended (decision → skipped outcome), append-only.
    const rows = await listFollowUpDecisionsForStory(runtimeDb, storyId);
    expect(rows.map((r) => r.recordKind)).toEqual(["decision", "outcome"]);
    expect(rows[1]!.outcome).toBe("skipped");
    // The unresolved decision is now resolved.
    expect(await latestUnresolvedDecision(runtimeDb, storyId)).toBeNull();

    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("recordFollowUpTakeAction (evaluator proposes nothing) APPENDS the take onto the posted prose (non-clobbering) and returns appended", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    // cleanupTake uses the LLM's TEXT response as the cleaned segment; evaluator proposes nothing.
    runtimeLlm = scriptedLlm("The cleaned follow-up segment.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[]]);
    runtimeTranscriber = new ScriptedTranscriber({ text: "raw follow-up transcript" });

    // The client's CURRENT editor text — the append MUST build on THIS, not a DB re-read.
    const PRIOR = "EDITED BASE TEXT.";
    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }), storyId, prose: PRIOR }),
    );

    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }
    // Non-clobbering: the new prose STARTS WITH the posted priorProse text.
    expect(result.prose.startsWith(PRIOR)).toBe(true);
    expect(result.prose).toContain("The cleaned follow-up segment.");
    expect(result.appendedSegment).toBe("The cleaned follow-up segment.");

    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBe(result.prose);
    // The follow-up take was appended as a real take.
    const takes = await listStoryRecordings(runtimeDb, storyId);
    expect(takes.map((t) => t.position)).toEqual([0, 1]);
  });

  it("recordFollowUpTakeAction (evaluator proposes) still APPENDS the take first, then returns follow_up", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    runtimeLlm = scriptedLlm("Tell me more about that window.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]);
    runtimeTranscriber = new ScriptedTranscriber({ text: ANSWER });

    const PRIOR = "EDITED BASE TEXT.";
    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }), storyId, prose: PRIOR }),
    );

    if (!("kind" in result) || result.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(result)}`);
    }
    expect(result.prompt).toBe("Tell me more about that window.");

    // The follow-up take's words were STILL appended before the next follow-up was proposed — the
    // story prose grew and starts with the posted priorProse (non-clobbering).
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose!.startsWith(PRIOR)).toBe(true);
    const takes = await listStoryRecordings(runtimeDb, storyId);
    expect(takes.map((t) => t.position)).toEqual([0, 1]);
  });

  it("recordAnswerAction (flag ON + askId, evaluator proposes nothing) APPENDS take 0 and returns appended (not ready)", async () => {
    const ownerPersonId = (
      await runtimeDb
        .insert(persons)
        .values({ displayName: "Nora", spokenName: "Nora", birthYear: 1950 })
        .returning()
    )[0]!.id;
    authCtx = { kind: "account", personId: ownerPersonId };
    const askId = await seedAnswerableAsk(runtimeDb, ownerPersonId, "What was your childhood home like?");
    // cleanupTake returns the LLM TEXT response as the cleaned take-0 prose.
    runtimeLlm = scriptedLlm("Cleaned take zero prose.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[]]); // nothing proposed
    runtimeTranscriber = new ScriptedTranscriber({ text: "raw take zero" });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }
    // Previously this flag-ON path skipped the append entirely (returned `ready`). Now take 0 is
    // appended and the cleaned segment IS the working prose.
    expect(result.prose).toBe("Cleaned take zero prose.");
    expect(result.appendedSegment).toBe("Cleaned take zero prose.");
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), result.storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBe("Cleaned take zero prose.");
  });

  it("recordAnswerAction (flag ON + askId, evaluator proposes) APPENDS take 0 first, then returns follow_up", async () => {
    const ownerPersonId = (
      await runtimeDb
        .insert(persons)
        .values({ displayName: "Nora", spokenName: "Nora", birthYear: 1950 })
        .returning()
    )[0]!.id;
    authCtx = { kind: "account", personId: ownerPersonId };
    const askId = await seedAnswerableAsk(runtimeDb, ownerPersonId, "What was your childhood home like?");
    runtimeLlm = scriptedLlm("Tell me more about that window.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]);
    runtimeTranscriber = new ScriptedTranscriber({ text: ANSWER });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    if (!("kind" in result) || result.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(result)}`);
    }
    expect(result.prompt).toBe("Tell me more about that window.");
    // Take 0's prose was ALREADY appended before the follow-up was proposed.
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), result.storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBeTruthy();
  });
});
