/**
 * Gap-driven follow-up, exercised through the CONTROLLED LOOP (issue #80). These tests prove:
 *   - a detected gap surfaces as the next question (when the priority order allows);
 *   - the behavior policy is still enforced ON the gap path (rapport, distress/off-ramp,
 *     one-question-at-a-time, anti-repeat);
 *   - the loop never becomes an open chat (still exactly one intent per turn).
 *
 * All LLM/evaluator interaction is via the ScriptedFollowUpEvaluator / ScriptedLanguageModel mocks —
 * no vendor call. The evaluator is scripted per-call so a test can drive turn 0 → turn 1 precisely.
 */
import { describe, expect, it } from "vitest";
import type { BiographicalProfile, FollowUpCandidate } from "@chronicle/db";
import {
  createInterviewSession,
  InMemoryAnchorSource,
  InMemoryAskSource,
  InMemoryMemorySource,
  ScriptedFollowUpEvaluator,
  ScriptedVoice,
  RAPPORT_THRESHOLD_TURNS,
  GAP_DETECTION_MIN_ANSWER_WORDS,
  type BiographicalAnchors,
  type InterviewerDeps,
  type PromptIntent,
} from "../src/index";
import { ScriptedLanguageModel } from "@chronicle/pipeline";

const NARRATOR = "narrator-1";

const COMPLETE_PROFILE: BiographicalProfile = {
  hometown: "Iowa",
  siblingContext: "Oldest of three",
  currentLocation: "Des Moines",
  occupationSummary: "Schoolteacher",
  hasChildren: false,
  hasGrandchildren: false,
};

// Anchors with a fully-populated profile so the picker has NO intake field to collect and — with no
// pending Asks / prior stories — falls through to the follow_up slot, where a queued gap surfaces.
function completeAnchors(): BiographicalAnchors {
  return { personId: NARRATOR, spokenName: "Eleanor", birthYear: 1942, profile: { ...COMPLETE_PROFILE } };
}

const cand = (over: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
  threadSeed: "the year they moved to Iowa",
  type: "temporal",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
  ...over,
});

// A long-enough answer to clear the detection floor.
const LONG_ANSWER =
  "We moved out to the farm when I was very small and everything about that place felt enormous to me.";

function makeDeps(evaluator?: ScriptedFollowUpEvaluator): InterviewerDeps {
  const askSource = new InMemoryAskSource();
  const memorySource = new InMemoryMemorySource();
  const anchorSource = new InMemoryAnchorSource();
  anchorSource.set(completeAnchors());
  const languageModel = new ScriptedLanguageModel({ respond: "Tell me about the farm." });
  const voice = new ScriptedVoice();
  const deps: InterviewerDeps = { languageModel, voice, askSource, memorySource, anchorSource };
  if (evaluator) deps.followUpEvaluator = evaluator;
  return deps;
}

describe("gap-driven follow-up in the controlled loop", () => {
  it("queues a detected gap and surfaces it as the NEXT question (gap origin)", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand()]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    await session.nextTurn(); // ask something
    await session.recordResponse(LONG_ANSWER); // gap detected + queued
    expect(evaluator.calls).toHaveLength(1);
    expect(session.getState().pendingGapFollowUp?.candidate.threadSeed).toBe(
      "the year they moved to Iowa",
    );

    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("follow_up");
    const fu = turn.intent as Extract<PromptIntent, { kind: "follow_up" }>;
    expect(fu.origin).toBe("gap");
    expect(fu.threadSeed).toBe("the year they moved to Iowa");
    expect(fu.gapKind).toBe("temporal");
    // The gap was consumed — not re-emitted, not lingering.
    expect(session.getState().pendingGapFollowUp).toBeNull();
    expect(session.getState().askedGapSeeds).toContain("the year they moved to Iowa");
  });

  it("emits exactly ONE intent per turn — a queued gap does not produce a second question", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand()], [cand({ threadSeed: "who came along" })]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    const t0 = await session.nextTurn();
    expect(t0.intent.kind).not.toBe("follow_up"); // first turn is intake/base, never a gap
    await session.recordResponse(LONG_ANSWER);

    const t1 = await session.nextTurn(); // the gap
    expect(t1.intent.kind).toBe("follow_up");
    // A turn returns a SINGLE intent object (never a list) and the phraser is told to speak one
    // thing. The spoken line must not smuggle a second question in (no "?" beyond the first).
    const firstQ = t1.spokenText.indexOf("?");
    const secondQ = t1.spokenText.indexOf("?", firstQ + 1);
    // With the ScriptedLanguageModel returning a fixed one-line phrasing, there is at most one "?".
    expect(secondQ).toBe(-1);
    // Recording another answer re-detects, but each nextTurn still yields exactly one intent.
    await session.recordResponse(LONG_ANSWER);
    const t2 = await session.nextTurn();
    expect(t2.intent).toBeDefined();
    expect(Array.isArray(t2.intent)).toBe(false);
  });

  it("suppresses a HIGH-sensitivity gap before the rapport threshold (rapport gate)", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand({ sensitivity: "high" })]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    await session.nextTurn(); // turnCount is now 1 — below RAPPORT_THRESHOLD_TURNS (4)
    expect(session.getState().turnCount).toBeLessThan(RAPPORT_THRESHOLD_TURNS);
    await session.recordResponse(LONG_ANSWER);

    // decideFollowUp vetoed the high-sensitivity candidate (below_rapport) → nothing queued.
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("admits a HIGH-sensitivity gap ONCE rapport is established", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand({ sensitivity: "high" })]]);
    const deps = makeDeps(evaluator);
    const session = await createInterviewSession(deps, { narratorPersonId: NARRATOR });

    // Advance past the rapport threshold with short answers (below the detection floor → no gap runs).
    for (let i = 0; i < RAPPORT_THRESHOLD_TURNS; i++) {
      await session.nextTurn();
      await session.recordResponse("Yes.");
    }
    expect(session.getState().turnCount).toBeGreaterThanOrEqual(RAPPORT_THRESHOLD_TURNS);
    expect(evaluator.calls).toHaveLength(0); // short answers never triggered detection

    await session.recordResponse(LONG_ANSWER);
    expect(session.getState().pendingGapFollowUp?.candidate.sensitivity).toBe("high");
  });

  it("distress on the answer short-circuits — no gap is even detected, and the loop winds down", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand()]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    await session.nextTurn();
    await session.recordResponse(
      "I can't talk about that, it hurts to think about how we moved away from the farm.",
    );
    // Detection is skipped entirely on distress (no LLM/evaluator call spent, nothing queued).
    expect(evaluator.calls).toHaveLength(0);
    expect(session.getState().pendingGapFollowUp).toBeNull();

    const turn = await session.nextTurn();
    expect(turn.intent.kind).toBe("wind_down");
  });

  it("off-ramp on the answer short-circuits gap detection", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand()]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });
    await session.nextTurn();
    await session.recordResponse("Let's skip that, I'm tired now and want to move on to something else.");
    expect(evaluator.calls).toHaveLength(0);
    expect(session.getState().pendingGapFollowUp).toBeNull();
    expect((await session.nextTurn()).intent.kind).toBe("wind_down");
  });

  it("does not run detection on a thin answer below the word floor", async () => {
    const evaluator = new ScriptedFollowUpEvaluator([[cand()]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });
    await session.nextTurn();
    const thin = Array.from({ length: GAP_DETECTION_MIN_ANSWER_WORDS - 1 }, () => "word").join(" ");
    await session.recordResponse(thin);
    expect(evaluator.calls).toHaveLength(0);
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("anti-repeat: a gap seed already asked this session is not re-queued", async () => {
    const seed = "the year they moved to Iowa";
    // Both turns propose the SAME seed; the second must be vetoed as a duplicate.
    const evaluator = new ScriptedFollowUpEvaluator([[cand({ threadSeed: seed })], [cand({ threadSeed: seed })]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    await session.nextTurn();
    await session.recordResponse(LONG_ANSWER); // queue #1
    await session.nextTurn(); // ask it → seed recorded in askedGapSeeds
    expect(session.getState().askedGapSeeds).toContain(seed);

    await session.recordResponse(LONG_ANSWER); // propose same seed again
    expect(evaluator.calls).toHaveLength(2);
    // duplicate → decideFollowUp drops it → nothing queued the second time.
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });

  it("clears a queued gap when distress/off-ramp latches on a LATER turn (state hygiene)", async () => {
    // Regression: a gap queued on turn N must not linger in getState() once the session winds down
    // on a subsequent answer. It is unreachable (slot 0 wins) — it must also not be dead data.
    const evaluator = new ScriptedFollowUpEvaluator([[cand()]]);
    const session = await createInterviewSession(makeDeps(evaluator), { narratorPersonId: NARRATOR });

    await session.nextTurn();
    await session.recordResponse(LONG_ANSWER); // gap queued
    expect(session.getState().pendingGapFollowUp).not.toBeNull();

    // The narrator now signals distress (without the queued gap having been served yet).
    await session.recordResponse("I can't talk about that anymore, please stop.");
    expect(session.getState().distressed).toBe(true);
    expect(session.getState().pendingGapFollowUp).toBeNull();

    // And the next turn winds down — the gap is never spoken.
    expect((await session.nextTurn()).intent.kind).toBe("wind_down");
  });

  it("with NO evaluator configured, the loop keeps its original reflection-only behavior", async () => {
    const session = await createInterviewSession(makeDeps(), { narratorPersonId: NARRATOR });
    await session.nextTurn();
    await session.recordResponse(LONG_ANSWER);
    // No gap machinery ran; nothing queued.
    expect(session.getState().pendingGapFollowUp).toBeNull();
  });
});
