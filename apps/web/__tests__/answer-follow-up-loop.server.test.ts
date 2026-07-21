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
/** Gap stage (production always wires this); undefined → deepen-only cascade for older tests. */
let runtimeGapEvaluator: FollowUpEvaluator | undefined;
let runtimeTranscriber: Transcriber;
let authCtx: { kind: string; personId?: string };

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({
    db: runtimeDb,
    storage: runtimeStorage,
    auth: { getCurrentAuthContext: async () => authCtx },
    languageModel: runtimeLlm,
    followUpEvaluator: runtimeEvaluator,
    gapFollowUpEvaluator: runtimeGapEvaluator,
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
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { InMemoryMediaStorage } from "@chronicle/storage";
import { hub } from "@/app/_copy";
import {
  runFollowUpStep,
  prepareAnswerDatingContext,
  recordAnswerAction,
  recordFollowUpTakeAction,
  declineFollowUpAction,
  appendTypedTakeAction,
  dropTakeAction,
} from "@/app/hub/answer/[askId]/actions";
import { FOLLOW_UP_BUDGET_MS } from "@/lib/follow-up-config";

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

  it("dating context → temporal system probe wins; ledger modelId is system:story-date", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]);
    const rt = {
      db,
      languageModel: scriptedLlm("Do you remember about when that was? A year is fine."),
      followUpEvaluator: deepen,
      gapFollowUpEvaluator: new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]),
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
      dating: { dateUnresolved: true, alreadyAsked: false },
    });

    expect(step?.kind).toBe("follow_up");
    expect(deepen.calls).toHaveLength(0);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evaluatorModelId).toBe("system:story-date");
    expect(rows[0]!.selectedSeed).toBe("about when this happened");
  });

  it("prepareAnswerDatingContext + stated year → Tier A persists; temporal probe stays dark", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);
    const dated =
      "It had a beautiful stained glass window in the front hall that my grandmother loved in 1958.";

    const dating = await prepareAnswerDatingContext(db, {
      storyId,
      ownerPersonId,
      text: dated,
      viewer: { kind: "account", personId: ownerPersonId },
    });
    expect(dating.dateUnresolved).toBe(false);
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1958-01-01");

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator([[]], "gap-model");
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("Tell me more about that stained glass window."),
        followUpEvaluator: deepen,
        gapFollowUpEvaluator: gap,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: dated,
        dating,
      },
    );

    // Temporal system probe N/A (dated); gap empty → deepen wins.
    expect(step?.kind).toBe("follow_up");
    expect(step?.prompt).toBe("Tell me more about that stained glass window.");
    expect(gap.calls).toHaveLength(1);
    expect(deepen.calls).toHaveLength(1);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows[0]!.evaluatorModelId).toBe("deepen-model");
  });

  it("dating just resolved → gap temporal candidate is dropped (race fix)", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator(
      [[{ ...STRONG_CANDIDATE, type: "temporal", threadSeed: "about when this happened" }]],
      "gap-model",
    );
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("should not phrase"),
        followUpEvaluator: deepen,
        gapFollowUpEvaluator: gap,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: ANSWER,
        dating: { dateUnresolved: false, alreadyAsked: false },
      },
    );

    // Cascade short-circuits at gap (temporal selected); post-dispose race fix drops it —
    // deepen was never called (same as interview turn-loop). No follow-up that turn.
    expect(step).toBeNull();
    expect(gap.calls).toHaveLength(1);
    expect(deepen.calls).toHaveLength(0);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.selectedSeed).toBeNull();
  });

  it("temporal already asked → gap with a DIFFERENT temporal seed is still dropped (latch)", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator(
      [[{ ...STRONG_CANDIDATE, type: "temporal", threadSeed: "the year of the move" }]],
      "gap-model",
    );
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("should not phrase"),
        followUpEvaluator: deepen,
        gapFollowUpEvaluator: gap,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: ANSWER,
        // Still Undated (skip / don't-know), but the one dating ask already fired.
        dating: { dateUnresolved: true, alreadyAsked: true },
      },
    );

    expect(step).toBeNull();
    expect(gap.calls).toHaveLength(1);
    expect(deepen.calls).toHaveLength(0);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.selectedSeed).toBeNull();
  });

  it("gap wins → deepen not called; ledger modelId is from the gap evaluator", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "gap-model");
    const rt = {
      db,
      languageModel: scriptedLlm("What else do you remember about that stained glass?"),
      followUpEvaluator: deepen,
      gapFollowUpEvaluator: gap,
    };

    const step = await runFollowUpStep(rt, {
      storyId,
      ownerPersonId,
      promptText: "What was your childhood home like?",
      answerTranscript: ANSWER,
    });

    expect(step?.kind).toBe("follow_up");
    expect(gap.calls).toHaveLength(1);
    expect(deepen.calls).toHaveLength(0);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evaluatorModelId).toBe("gap-model");
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
  });

  it("gap empty → deepen wins; ledger modelId is from the deepen evaluator", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator([[]], "gap-model");
    const rt = {
      db,
      languageModel: scriptedLlm("Tell me more about that stained glass window."),
      followUpEvaluator: deepen,
      gapFollowUpEvaluator: gap,
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
    expect(gap.calls).toHaveLength(1);
    expect(deepen.calls).toHaveLength(1);
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evaluatorModelId).toBe("deepen-model");
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
  });

  it("gap-empty → deepen still completes under budget with slow cascade stages", async () => {
    // Regression: budget must cover gap + deepen + phrase (not deepen-only). Each stage sleeps
    // long enough that the sum exceeds the old 8s deepen-only budget but fits under FOLLOW_UP_BUDGET_MS.
    expect(FOLLOW_UP_BUDGET_MS).toBeGreaterThanOrEqual(12_000);
    const perStageMs = 4_500;
    expect(perStageMs * 2).toBeGreaterThan(8_000);
    expect(perStageMs * 2).toBeLessThan(FOLLOW_UP_BUDGET_MS);

    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const gap: FollowUpEvaluator = {
      async evaluate() {
        await delay(perStageMs);
        return { candidates: [], modelId: "slow-gap" };
      },
    };
    const deepen: FollowUpEvaluator = {
      async evaluate() {
        await delay(perStageMs);
        return { candidates: [STRONG_CANDIDATE], modelId: "slow-deepen" };
      },
    };

    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("Tell me more about that stained glass window."),
        followUpEvaluator: deepen,
        gapFollowUpEvaluator: gap,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: ANSWER,
      },
    );

    expect(step?.kind).toBe("follow_up");
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evaluatorModelId).toBe("slow-deepen");
  }, 25_000);

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

  it("drop = audio-only: dropping a follow-up take removes it + its prose_revisions, NO re-stitch, prose + state unchanged", async () => {
    // ADR-0014 Inc 3 slice 7: dropTakeAction no longer re-stitches. dropStoryRecording removes the
    // take's audio AND its per-take prose_revisions (FK regression), but the working prose and the
    // story state are UNCHANGED — the narrator edits the text out manually (decision d).
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    const [take0] = await listStoryRecordings(db, storyId);
    // Take 0's working prose (via a real append — writes take-0 prose_revisions that must SURVIVE).
    await appendVoiceTakeContribution(db, {
      storyId,
      ownerPersonId,
      storyRecordingId: take0!.id,
      rawTranscript: "take zero raw",
      cleanedSegment: "Take zero cleaned.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: null,
    });

    // Append a REAL follow-up take (position 1) + its prose_revisions (as recordFollowUpTake does).
    const take1 = await persistTakeRecording(
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
    await appendVoiceTakeContribution(db, {
      storyId,
      ownerPersonId,
      storyRecordingId: take1.storyRecording.id,
      rawTranscript: "take one raw",
      cleanedSegment: "Take one cleaned.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: "Take zero cleaned.",
    });
    expect((await listStoryRecordings(db, storyId)).map((t) => t.position)).toEqual([0, 1]);
    const proseBefore = (await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId))!.prose;

    // Drop the follow-up take (pre-approval) — no throw despite its prose_revisions FK.
    await dropStoryRecording(db, { storyId, position: 1, narratorPersonId: ownerPersonId });

    // Only take 0 remains; NO re-stitch, so the state stays draft and the prose is UNTOUCHED.
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect((await listStoryRecordings(db, storyId)).map((t) => t.position)).toEqual([0]);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBe(proseBefore);
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
  }, FOLLOW_UP_BUDGET_MS + 10_000);
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
    runtimeGapEvaluator = undefined;
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

  it("dropTakeAction (position > 0) removes the follow-up take audio ONLY: take_dropped, no re-stitch, prose + state unchanged", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };

    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    // Take 0 working prose (real append → take-0 prose_revisions that must survive the drop).
    await appendVoiceTakeContribution(runtimeDb, {
      storyId,
      ownerPersonId,
      storyRecordingId: take0!.id,
      rawTranscript: "take zero raw",
      cleanedSegment: "Take zero cleaned.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: null,
    });
    const key1 = `story-audio/${ownerPersonId}/t1.webm`;
    const take1 = await persistTakeRecording(
      runtimeDb,
      { ownerPersonId, storageKey: key1, contentType: "audio/webm", durationSeconds: 30, checksum: "sha256:t1" },
      storyId,
    );
    // Real follow-up append → take-1 prose_revisions (the FK rows the drop must clear).
    await appendVoiceTakeContribution(runtimeDb, {
      storyId,
      ownerPersonId,
      storyRecordingId: take1.storyRecording.id,
      rawTranscript: "take one raw",
      cleanedSegment: "Take one cleaned.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: "Take zero cleaned.",
    });
    await runtimeStorage.put({ key: key1, bytes: new Uint8Array([9]), contentType: "audio/webm" });
    const proseBefore = (await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId))!.prose;

    const result = await dropTakeAction(form({ storyId, position: "1" }));

    // Audio-only: new take_dropped variant, blob deleted, state UNCHANGED (still draft), prose kept.
    expect(result).toEqual({ kind: "take_dropped", storyId });
    expect(await runtimeStorage.exists(key1)).toBe(false);
    const remaining = await listStoryRecordings(runtimeDb, storyId);
    expect(remaining.map((t) => t.position)).toEqual([0]);
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    expect(story!.prose).toBe(proseBefore);
  });

  it("recordFollowUpTakeAction → dropTakeAction(position 1) end-to-end: real follow-up take drops with no FK throw, audio gone, prose kept", async () => {
    // End-to-end regression for the slice-7 FK bug: a REAL follow-up take (its prose_revisions
    // reference the recording) must drop cleanly. Drive recordFollowUpTakeAction to append the take.
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await updateStoryRecordingTranscript(runtimeDb, {
      storyRecordingId: take0!.id,
      transcript: "Take zero words.",
    });
    runtimeLlm = scriptedLlm("Cleaned follow-up segment.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[]]); // no further follow-up proposed
    runtimeTranscriber = new ScriptedTranscriber({ text: "raw follow-up" });

    const appendResult = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([7, 7, 7])], { type: "audio/webm" }), storyId, prose: "EDITED BASE." }),
    );
    if (!("kind" in appendResult) || appendResult.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(appendResult)}`);
    }
    expect((await listStoryRecordings(runtimeDb, storyId)).map((t) => t.position)).toEqual([0, 1]);
    const proseBefore = appendResult.prose;

    // Drop the just-recorded follow-up take — must NOT throw an FK violation.
    const dropResult = await dropTakeAction(form({ storyId, position: "1" }));

    expect(dropResult).toEqual({ kind: "take_dropped", storyId });
    expect((await listStoryRecordings(runtimeDb, storyId)).map((t) => t.position)).toEqual([0]);
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    // The dropped take's TEXT is intentionally kept in the working prose (decision d).
    expect(story!.prose).toBe(proseBefore);
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

  it("recordFollowUpTakeAction rejects a missing `prose` FormData field (required-prose guard) and ingests no take", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const before = await listStoryRecordings(runtimeDb, storyId);
    expect(before.map((t) => t.position)).toEqual([0]);

    // No `prose` field → the required-prose input guard fires BEFORE any ingest.
    const result = await recordFollowUpTakeAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), storyId }),
    );

    expect(result).toEqual({ error: hub.actions.invalidInput });
    // No follow-up take was ingested — the story still has only take 0.
    const after = await listStoryRecordings(runtimeDb, storyId);
    expect(after.map((t) => t.position)).toEqual([0]);
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

  it("declineFollowUpAction rejects a non-draft/foreign story (IDOR → storyNotFound)", async () => {
    const { storyId } = await seedDraft(runtimeDb);
    const [mallory] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Mallory", spokenName: "Mallory" })
      .returning();
    authCtx = { kind: "account", personId: mallory!.id };

    const result = await declineFollowUpAction(form({ storyId }));
    expect(result).toEqual({ error: hub.actions.storyNotFound });
  });

  it("declineFollowUpAction (decline) makes NO LLM call, returns appended with the current prose, draft stays open", async () => {
    // Slice 6: decline records the skip and returns to the draft surface — no stitch, no render, no
    // transition. Wiring a throwing LLM proves declineFollowUpAction never calls the model.
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
    runtimeLlm = throwingLlm; // if declineFollowUpAction called the LLM at all, this would throw

    // No `prose` posted → the server echoes its own working text unchanged.
    const result = await declineFollowUpAction(form({ storyId }));

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

  it("declineFollowUpAction ECHOES the client's posted prose (forward-risk (i): non-clobbering)", async () => {
    // ADR-0014 Inc 3 slice 10: the composing editor is now always mounted while the follow-up banner
    // shows, so the narrator may have unsaved hand-edits. Decline must echo the CLIENT'S prose back
    // (never a fresh DB read) so seeding it never overwrites those edits. Here the DB prose and the
    // posted prose deliberately differ; the action must return the POSTED one, with an empty segment.
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await appendVoiceTakeContribution(runtimeDb, {
      storyId,
      ownerPersonId,
      storyRecordingId: take0!.id,
      rawTranscript: "Take zero words.",
      cleanedSegment: "Server-side working prose.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: null,
    });
    runtimeLlm = throwingLlm;

    const CLIENT_EDIT = "Server-side working prose. Plus an unsaved hand-edit.";
    const result = await declineFollowUpAction(form({ storyId, prose: CLIENT_EDIT }));

    expect(result).toEqual({
      kind: "appended",
      storyId,
      prose: CLIENT_EDIT, // the posted client text, NOT the DB "Server-side working prose."
      appendedSegment: "",
    });
    // Echo only — the decline never PERSISTS the client edit (that rides the next append/Finish).
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.prose).toBe("Server-side working prose.");
  });

  it("declineFollowUpAction appends a `skipped` outcome for an unresolved follow-up (append-only), draft stays open", async () => {
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

    const result = await declineFollowUpAction(form({ storyId }));
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

  it("appendTypedTakeAction appends a typed take onto an EXISTING draft's posted prose (non-clobbering)", async () => {
    // ADR-0014 Inc 3 slice 10: the composing footer's type-box is live for take ≥ 1 via this new
    // front door (composeStoryAction only ever creates take-0). It concatenates onto the CLIENT'S
    // posted prose, never a DB re-read, and keeps the draft in `draft` state (no transition).
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const [take0] = await listStoryRecordings(runtimeDb, storyId);
    await appendVoiceTakeContribution(runtimeDb, {
      storyId,
      ownerPersonId,
      storyRecordingId: take0!.id,
      rawTranscript: "Spoken take zero.",
      cleanedSegment: "Spoken take zero.",
      transcribeModelId: "m",
      cleanupModelId: "m",
      cleanupPromptText: "p",
      priorProse: null,
    });

    const PRIOR = "Spoken take zero. With a hand-edit.";
    const result = await appendTypedTakeAction(
      form({ storyId, text: "  A typed addition.  ", prose: PRIOR }),
    );

    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }
    // Builds on the posted prose (non-clobbering), trims the typed text, and stays `draft`.
    expect(result.prose.startsWith(PRIOR)).toBe(true);
    expect(result.prose).toContain("A typed addition.");
    expect(result.appendedSegment).toBe("A typed addition.");
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
    // NO story_recordings row is created for a typed take.
    expect(await listStoryRecordings(runtimeDb, storyId)).toHaveLength(1);
  });

  it("appendTypedTakeAction rejects a foreign/non-draft story (IDOR → storyNotFound)", async () => {
    const { storyId } = await seedDraft(runtimeDb);
    const [mallory] = await runtimeDb
      .insert(persons)
      .values({ displayName: "Mallory", spokenName: "Mallory" })
      .returning();
    authCtx = { kind: "account", personId: mallory!.id };
    const result = await appendTypedTakeAction(form({ storyId, text: "hi", prose: "" }));
    expect(result).toEqual({ error: hub.actions.storyNotFound });
  });

  it("appendTypedTakeAction rejects empty text (invalidInput)", async () => {
    const { ownerPersonId, storyId } = await seedDraft(runtimeDb);
    authCtx = { kind: "account", personId: ownerPersonId };
    const result = await appendTypedTakeAction(form({ storyId, text: "   ", prose: "x" }));
    expect(result).toEqual({ error: hub.actions.invalidInput });
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

  it("recordAnswerAction (flag ON + askId, undated take) → temporal follow-up wins over deepen", async () => {
    const ownerPersonId = (
      await runtimeDb
        .insert(persons)
        .values({ displayName: "Nora", spokenName: "Nora", birthYear: 1950 })
        .returning()
    )[0]!.id;
    authCtx = { kind: "account", personId: ownerPersonId };
    const askId = await seedAnswerableAsk(runtimeDb, ownerPersonId, "What was your childhood home like?");
    runtimeLlm = scriptedLlm("Do you remember about when that was? A year is fine.");
    runtimeEvaluator = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]]);
    runtimeTranscriber = new ScriptedTranscriber({ text: ANSWER });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    if (!("kind" in result) || result.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(result)}`);
    }
    expect(result.prompt).toBe("Do you remember about when that was? A year is fine.");
    const rows = await listFollowUpDecisionsForStory(runtimeDb, result.storyId);
    expect(rows[0]!.evaluatorModelId).toBe("system:story-date");
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), result.storyId);
    expect(story!.state).toBe("draft");
    expect(story!.occurredKind).toBeNull();
  });

  it("recordAnswerAction (flag ON + askId, stated year) → Tier A dates; deepen follow-up (not temporal)", async () => {
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
    runtimeTranscriber = new ScriptedTranscriber({
      text: "It had a beautiful stained glass window in the front hall that my grandmother loved in 1958.",
    });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    if (!("kind" in result) || result.kind !== "follow_up") {
      throw new Error(`expected a follow_up step, got ${JSON.stringify(result)}`);
    }
    expect(result.prompt).toBe("Tell me more about that window.");
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), result.storyId);
    expect(story!.state).toBe("draft");
    expect(story!.occurredKind).toBe("period");
    expect(story!.occurredDate).toBe("1958-01-01");
    const rows = await listFollowUpDecisionsForStory(runtimeDb, result.storyId);
    expect(rows[0]!.evaluatorModelId).not.toBe("system:story-date");
  });

  it("recordAnswerAction (FOLLOW_UPS_ENABLED=false + askId) stays dark: appended, evaluators never called", async () => {
    process.env.FOLLOW_UPS_ENABLED = "false";
    const ownerPersonId = (
      await runtimeDb
        .insert(persons)
        .values({ displayName: "Nora", spokenName: "Nora", birthYear: 1950 })
        .returning()
    )[0]!.id;
    authCtx = { kind: "account", personId: ownerPersonId };
    const askId = await seedAnswerableAsk(runtimeDb, ownerPersonId, "What was your childhood home like?");
    runtimeLlm = scriptedLlm("Cleaned take zero prose.");
    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "gap-model");
    runtimeEvaluator = deepen;
    runtimeGapEvaluator = gap;
    runtimeTranscriber = new ScriptedTranscriber({ text: ANSWER });

    const result = await recordAnswerAction(
      form({ audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }), askId }),
    );

    if (!("kind" in result) || result.kind !== "appended") {
      throw new Error(`expected an appended step, got ${JSON.stringify(result)}`);
    }
    expect(deepen.calls).toHaveLength(0);
    expect(gap.calls).toHaveLength(0);
    const rows = await listFollowUpDecisionsForStory(runtimeDb, result.storyId);
    expect(rows).toHaveLength(0);
    const story = await getStoryForViewer(runtimeDb, ownerCtx(ownerPersonId), result.storyId);
    expect(story!.state).toBe("draft");
  });
});
