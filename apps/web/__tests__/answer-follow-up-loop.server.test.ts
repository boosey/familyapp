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
import { persons } from "@chronicle/db/schema";
import {
  persistRecordingAndCreateDraft,
  persistTakeRecording,
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
  recordFollowUpTakeAction,
  finishThreadAction,
  dropTakeAction,
} from "@/app/hub/answer/[askId]/actions";

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

  it("finishes the thread when nothing is selected: records a null-seed decision + stitches to pending_approval", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    // Take 0 already transcribed (its transcript is the stitched output).
    const [take0] = await listStoryRecordings(db, storyId);
    await updateStoryRecordingTranscript(db, {
      storyRecordingId: take0!.id,
      transcript: "It had a beautiful stained glass window.",
    });

    const rt = {
      db,
      languageModel: scriptedLlm("(unused — nothing selected)"),
      followUpEvaluator: new ScriptedFollowUpEvaluator([[]]), // no candidates → thread ends
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    expect(step).toEqual({ kind: "ready", storyId });

    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordKind).toBe("decision");
    expect(rows[0]!.selectedSeed).toBeNull();
    expect(rows[0]!.phrasedLine).toBeNull();

    // The story was stitched + polished ONCE → pending_approval with the stitched transcript + prose.
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.transcript).toBe("It had a beautiful stained glass window.");
    expect(story!.prose).toBeTruthy();
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
    if (!("kind" in step1) || step1.kind !== "follow_up") {
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

    // Turn 1: evaluator proposes nothing → the thread finishes.
    const step2 = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: unresolved!.phrasedLine ?? "",
      answerTranscript: ANSWER_2,
    });
    expect(step2).toEqual({ kind: "ready", storyId });

    // The ledger reads decision → outcome → decision (append-only, in order).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows.map((r) => r.recordKind)).toEqual(["decision", "outcome", "decision"]);
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
    expect(rows[1]!.outcome).toBe("answered");
    expect(rows[2]!.selectedSeed).toBeNull();
    expect(rows[2]!.threadPosition).toBe(1);

    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
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

  it("degrades when the evaluator throws: story still finalizes with stitched prose (sharing never blocked)", async () => {
    // Headline safety (handoff watch #2): a broken evaluator must not block sharing.
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

    expect(step).toEqual({ kind: "ready", storyId });

    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.transcript).toBe("It had a beautiful stained glass window.");
    expect(story!.prose).toBeTruthy();

    // The failed turn wrote NO decision row (evaluate/phrase run before appendFollowUpDecision).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(0);
  });

  it("degrades on a budget timeout: a never-resolving evaluator still finalizes the story", async () => {
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

    expect(step).toEqual({ kind: "ready", storyId });
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    expect(story!.prose).toBeTruthy();
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
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), storyId }),
    );

    expect(result).toEqual({ error: hub.actions.storyNotFound });
  });

  it("recordFollowUpTakeAction degrades to a graceful finish when transcription fails (no 500)", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    runtimeTranscriber = throwingTranscriber; // the follow-up take's transcribe will throw

    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }), storyId }),
    );

    // Graceful finish: the take's audio is durable, the takes-so-far are stitched → review.
    expect(result).toEqual({ kind: "ready", storyId });
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("pending_approval");
    // The dropped-in follow-up take was still appended (its audio is durable), just un-transcribed.
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

  it("finishThreadAction returns a retryable error when the render fails (no 500)", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    runtimeLlm = throwingLlm; // the single stitch/polish render throws

    const result = await finishThreadAction(form({ storyId }));

    expect(result).toEqual({ error: hub.actions.saveFailed });
    // The story was NOT finalized — it stays a draft so the narrator can retry.
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });
});
