/**
 * proposeAndDisposeFollowUp cascade — unit tests for ordering and short-circuit.
 */
import { describe, expect, it, vi } from "vitest";
import type { FollowUpCandidate, FollowUpPolicy } from "@chronicle/db";
import { resolveFollowUpPolicy } from "../src/follow-up-policy";
import { proposeAndDisposeFollowUp } from "../src/follow-up-cascade";
import { createTemporalFollowUpProbe } from "../src/temporal-follow-up-probe";
import {
  STORY_DATE_FOLLOW_UP_SEED,
  SYSTEM_STORY_DATE_MODEL_ID,
} from "../src/constants";
import type { FollowUpEvaluator } from "../src/contracts";
import type { SystemFollowUpProbe } from "../src/system-follow-up-probe";

const LONG =
  "We moved out to the farm when I was very small and everything about that place felt enormous to me.";

const cand = (over: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
  threadSeed: "the stained glass",
  type: "factual",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
  ...over,
});

function scripted(candidates: FollowUpCandidate[], modelId = "scripted"): FollowUpEvaluator {
  return {
    evaluate: vi.fn(async () => ({ candidates, modelId })),
  };
}

function baseDecide(over: Partial<Parameters<typeof proposeAndDisposeFollowUp>[0]["decide"]> = {}) {
  const policy: FollowUpPolicy = resolveFollowUpPolicy({ enabled: true });
  return {
    policy,
    answerWordCount: LONG.split(/\s+/).length,
    followUpsAskedInThread: 0,
    followUpsAskedInSession: 0,
    distressed: false,
    offRampRequested: false,
    rapportEstablished: true,
    alreadyAskedSeeds: [] as string[],
    ...over,
  };
}

const evalInput = {
  answerTranscript: LONG,
  promptText: "Tell me about the farm.",
  alreadyAskedSeeds: [] as string[],
  coveredCategories: [] as string[],
  followUpsAskedInThread: 0,
  rapportEstablished: true,
};

describe("proposeAndDisposeFollowUp cascade", () => {
  it("probe wins → gap and deepen are not called", async () => {
    const gap = scripted([cand({ threadSeed: "gap seed" })], "gap-model");
    const deepen = scripted([cand({ threadSeed: "deepen seed" })], "deepen-model");
    const probe = createTemporalFollowUpProbe();

    const result = await proposeAndDisposeFollowUp({
      probes: [probe],
      probeContext: {
        answerTranscript: LONG,
        dating: { alreadyAsked: false, dateUnresolved: true },
      },
      gapEvaluator: gap,
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });

    expect(result.stage).toBe("system");
    expect(result.origin).toBe("system");
    expect(result.gapKind).toBe("temporal");
    expect(result.decision.selected?.threadSeed).toBe(STORY_DATE_FOLLOW_UP_SEED);
    expect(result.evaluation.modelId).toBe(SYSTEM_STORY_DATE_MODEL_ID);
    expect(gap.evaluate).not.toHaveBeenCalled();
    expect(deepen.evaluate).not.toHaveBeenCalled();
  });

  it("probe N/A → gap wins; deepen not called", async () => {
    const gap = scripted([cand({ threadSeed: "the year they moved", type: "temporal" })], "gap-model");
    const deepen = scripted([cand({ threadSeed: "deepen seed" })], "deepen-model");
    const probe = createTemporalFollowUpProbe();

    const result = await proposeAndDisposeFollowUp({
      probes: [probe],
      probeContext: { answerTranscript: LONG }, // no dating → temporal N/A
      gapEvaluator: gap,
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });

    expect(result.stage).toBe("gap");
    expect(result.origin).toBe("gap");
    expect(result.decision.selected?.threadSeed).toBe("the year they moved");
    expect(result.evaluation.modelId).toBe("gap-model");
    expect(gap.evaluate).toHaveBeenCalledOnce();
    expect(deepen.evaluate).not.toHaveBeenCalled();
  });

  it("gap empty → deepen wins", async () => {
    const gap = scripted([], "gap-model");
    const deepen = scripted([cand()], "deepen-model");

    const result = await proposeAndDisposeFollowUp({
      gapEvaluator: gap,
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });

    expect(result.stage).toBe("deepen");
    expect(result.origin).toBe("reflection");
    expect(result.decision.selected?.threadSeed).toBe("the stained glass");
    expect(result.evaluation.modelId).toBe("deepen-model");
  });

  it("distress short-circuits before probes and LLM stages", async () => {
    const gap = scripted([cand()], "gap-model");
    const deepen = scripted([cand()], "deepen-model");
    const probe = createTemporalFollowUpProbe();
    const maybePropose = vi.spyOn(probe, "maybePropose");

    const result = await proposeAndDisposeFollowUp({
      probes: [probe],
      probeContext: {
        answerTranscript: LONG,
        dating: { alreadyAsked: false, dateUnresolved: true },
      },
      gapEvaluator: gap,
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide({ distressed: true }),
    });

    expect(result.stage).toBe("none");
    expect(result.origin).toBeNull();
    expect(result.decision.shortCircuit).toBe("distress_shortcircuit");
    expect(maybePropose).not.toHaveBeenCalled();
    expect(gap.evaluate).not.toHaveBeenCalled();
    expect(deepen.evaluate).not.toHaveBeenCalled();
  });

  it("temporal latch: alreadyAsked blocks second temporal proposal", async () => {
    const gap = scripted([cand({ threadSeed: "gap fallback" })], "gap-model");
    const probe = createTemporalFollowUpProbe();

    const result = await proposeAndDisposeFollowUp({
      probes: [probe],
      probeContext: {
        answerTranscript: LONG,
        dating: { alreadyAsked: true, dateUnresolved: true },
      },
      gapEvaluator: gap,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });

    expect(result.stage).toBe("gap");
    expect(result.decision.selected?.threadSeed).toBe("gap fallback");
  });

  it("deepen-only still works when gap is omitted", async () => {
    const deepen = scripted([cand()], "deepen-only");
    const result = await proposeAndDisposeFollowUp({
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });
    expect(result.stage).toBe("deepen");
    expect(result.origin).toBe("reflection");
    expect(result.evaluation.modelId).toBe("deepen-only");
  });

  it("gap-only still works when deepen is omitted", async () => {
    const gap = scripted([cand({ threadSeed: "who came along", type: "relational" })], "gap-only");
    const result = await proposeAndDisposeFollowUp({
      gapEvaluator: gap,
      evaluationInput: evalInput,
      decide: baseDecide(),
    });
    expect(result.stage).toBe("gap");
    expect(result.origin).toBe("gap");
    expect(result.gapKind).toBe("relational");
  });

  it("probe that does not apply does not block a later probe", async () => {
    const noop: SystemFollowUpProbe = {
      id: "noop",
      maybePropose: () => null,
    };
    const temporal = createTemporalFollowUpProbe();
    const result = await proposeAndDisposeFollowUp({
      probes: [noop, temporal],
      probeContext: {
        answerTranscript: LONG,
        dating: { alreadyAsked: false, dateUnresolved: true },
      },
      evaluationInput: evalInput,
      decide: baseDecide(),
    });
    expect(result.stage).toBe("system");
    expect(result.decision.selected?.threadSeed).toBe(STORY_DATE_FOLLOW_UP_SEED);
  });
});
