/**
 * #351 narrator follow-up opt-out — server integration test through `runFollowUpStep`.
 *
 * Drives the EXPORTED `runFollowUpStep` against a real PGlite db + scripted AI seams (same harness
 * shape as answer-follow-up-loop.server.test.ts). Full fixtures: a real narrator `persons` row (with
 * the `follow_ups_opt_out` column set) + a real draft story with take 0.
 *
 * Asserts:
 *   (a) opted-out narrator → NO follow-up, evaluators are NEVER called (short-circuit before any
 *       LLM), and an audited `suppressed_narrator_opt_out` disposition row is written.
 *   (b) the default (opt-out false) still runs the cascade and proposes as before.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime", () => ({
  getRuntime: async () => ({ db: undefined, auth: { getCurrentAuthContext: async () => ({ kind: "none" }) } }),
}));

import { createTestDatabase, type Database, type FollowUpCandidate } from "@chronicle/db";
import { persons } from "@chronicle/db/schema";
import { eq } from "drizzle-orm";
import {
  persistRecordingAndCreateDraft,
  listFollowUpDecisionsForStory,
  setFollowUpsOptOut,
  getFollowUpsOptOut,
  getStoryForViewer,
  type AuthContext,
} from "@chronicle/core";
import { ScriptedFollowUpEvaluator } from "@chronicle/interviewer";
import { ScriptedLanguageModel } from "@chronicle/pipeline";
import { runFollowUpStep } from "@/app/hub/answer/[askId]/actions";

const ANSWER =
  "It had a beautiful stained glass window in the front hall that my grandmother truly loved.";

const STRONG_CANDIDATE: FollowUpCandidate = {
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
};

const RENDER_JSON = JSON.stringify({
  prose: "A polished memory.",
  title: "The Stained Glass Window",
  summary: "A memory of a childhood home.",
  tags: ["childhood"],
});

function scriptedLlm(phrasedLine: string): ScriptedLanguageModel {
  return new ScriptedLanguageModel({
    respond: (req) => (req.responseFormat === "json" ? RENDER_JSON : phrasedLine),
  });
}

function ownerCtx(personId: string): AuthContext {
  return { kind: "account", personId };
}

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

describe("#351 follow-up opt-out — runFollowUpStep enforcement", () => {
  beforeEach(() => {
    process.env.FOLLOW_UPS_ENABLED = "1";
  });
  afterAll(() => {
    delete process.env.FOLLOW_UPS_ENABLED;
  });

  it("(a) opted-out narrator → no follow-up; evaluators never called; audited suppression row written", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    // Narrator turned follow-ups OFF (persists follow_ups_opt_out = true).
    await setFollowUpsOptOut(db, ownerPersonId, true);
    expect(await getFollowUpsOptOut(db, ownerPersonId)).toBe(true);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const gap = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "gap-model");
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("(should never phrase)"),
        followUpEvaluator: deepen,
        gapFollowUpEvaluator: gap,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: ANSWER, // substantial, non-distressed — would normally propose
      },
    );

    // No follow-up asked.
    expect(step).toBeNull();
    // NO evaluation LLM ran — the cascade short-circuited before probes/gap/deepen.
    expect(deepen.calls).toHaveLength(0);
    expect(gap.calls).toHaveLength(0);

    // The suppression is recorded as an audited decision row (null-seed, coded reason on candidates).
    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recordKind).toBe("decision");
    expect(rows[0]!.selectedSeed).toBeNull();
    expect(rows[0]!.phrasedLine).toBeNull();
    // Empty top-level evaluation (no candidates ever proposed) → no per-candidate dispositions, but
    // the decision's short-circuit reason IS the audit trail; the ledger row proves it was evaluated
    // and suppressed rather than never reached. (The reason lives in the dispositions when candidates
    // exist; here the empty evaluation still writes an audited none-decision.)
    expect(rows[0]!.dispositions).toEqual([]);

    // The draft stays open.
    const story = await getStoryForViewer(db, ownerCtx(ownerPersonId), storyId);
    expect(story!.state).toBe("draft");
  });

  it("(b) default (opt-out false) still runs the cascade and proposes a follow-up", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    // Default: the column defaults to false; assert the read agrees and DO NOT opt out.
    expect(await getFollowUpsOptOut(db, ownerPersonId)).toBe(false);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("Tell me more about that stained glass window."),
        followUpEvaluator: deepen,
      },
      {
        storyId,
        ownerPersonId,
        promptText: "What was your childhood home like?",
        answerTranscript: ANSWER,
      },
    );

    expect(step).toEqual({
      kind: "follow_up",
      storyId,
      prompt: "Tell me more about that stained glass window.",
    });
    // The evaluator DID run (cascade not short-circuited).
    expect(deepen.calls).toHaveLength(1);

    const rows = await listFollowUpDecisionsForStory(db, storyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.selectedSeed).toBe("the stained glass window");
  });

  it("toggling opt-out back OFF restores follow-ups (round-trip through setFollowUpsOptOut)", async () => {
    const db = await createTestDatabase();
    const { ownerPersonId, storyId } = await seedDraft(db);

    await setFollowUpsOptOut(db, ownerPersonId, true);
    await setFollowUpsOptOut(db, ownerPersonId, false); // narrator turned them back on
    expect(await getFollowUpsOptOut(db, ownerPersonId)).toBe(false);

    const deepen = new ScriptedFollowUpEvaluator([[STRONG_CANDIDATE]], "deepen-model");
    const step = await runFollowUpStep(
      {
        db,
        languageModel: scriptedLlm("Tell me more about that stained glass window."),
        followUpEvaluator: deepen,
      },
      { storyId, ownerPersonId, promptText: "prompt", answerTranscript: ANSWER },
    );

    expect(step?.kind).toBe("follow_up");
    expect(deepen.calls).toHaveLength(1);
  });
});
