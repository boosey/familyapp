/**
 * #351 narrator follow-up opt-out — cascade + dispose unit tests.
 *
 * When a narrator has turned follow-ups off (`narratorOptedOut: true`), the cascade must
 * short-circuit at the TOP: no probe consulted, no gap/deepen evaluator called, and the suppression
 * recorded as an audited `suppressed_narrator_opt_out` disposition on every proposed candidate. The
 * default (opt-out false) must run the cascade exactly as before.
 */
import { describe, expect, it, vi } from "vitest";
import type { FollowUpCandidate, FollowUpPolicy } from "@chronicle/db";
import { resolveFollowUpPolicy } from "../src/follow-up-policy";
import { proposeAndDisposeFollowUp } from "../src/follow-up-cascade";
import { decideFollowUp } from "../src/behavior";
import { createTemporalFollowUpProbe } from "../src/temporal-follow-up-probe";
import type { FollowUpEvaluator } from "../src/contracts";

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
  return { evaluate: vi.fn(async () => ({ candidates, modelId })) };
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

describe("#351 follow-up opt-out — proposeAndDisposeFollowUp", () => {
  it("opted-out narrator: short-circuits before any probe or LLM stage with an audited disposition", async () => {
    const gap = scripted([cand({ threadSeed: "gap seed" })], "gap-model");
    const deepen = scripted([cand({ threadSeed: "deepen seed" })], "deepen-model");
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
      decide: baseDecide({ narratorOptedOut: true }),
    });

    // No ask, cascade stops at the top.
    expect(result.stage).toBe("none");
    expect(result.origin).toBeNull();
    expect(result.decision.selected).toBeNull();
    // The suppression is the recorded short-circuit reason (audited disposition).
    expect(result.decision.shortCircuit).toBe("suppressed_narrator_opt_out");
    // NO probe consulted, NO evaluation LLM run.
    expect(maybePropose).not.toHaveBeenCalled();
    expect(gap.evaluate).not.toHaveBeenCalled();
    expect(deepen.evaluate).not.toHaveBeenCalled();
  });

  it("opt-out marks EVERY proposed candidate suppressed (nothing dropped silently)", async () => {
    // Even with an empty top-level evaluation (the cascade never runs evaluators on opt-out),
    // decideFollowUp records the short-circuit reason across whatever candidates it is given.
    const decision = decideFollowUp({
      ...baseDecide({ narratorOptedOut: true }),
      evaluation: {
        candidates: [cand({ threadSeed: "a" }), cand({ threadSeed: "b" })],
        modelId: "m",
      },
    });
    expect(decision.selected).toBeNull();
    expect(decision.shortCircuit).toBe("suppressed_narrator_opt_out");
    expect(decision.dispositions).toHaveLength(2);
    expect(decision.dispositions.every((d) => d.reason === "suppressed_narrator_opt_out")).toBe(true);
    expect(decision.dispositions.every((d) => d.selected === false)).toBe(true);
  });

  it("opt-out is checked BEFORE distress (its own distinct reason, not distress_shortcircuit)", async () => {
    const decision = decideFollowUp({
      ...baseDecide({ narratorOptedOut: true, distressed: true }),
      evaluation: { candidates: [cand()], modelId: "m" },
    });
    expect(decision.shortCircuit).toBe("suppressed_narrator_opt_out");
  });

  it("default (opt-out false) still runs the cascade and can select a follow-up", async () => {
    const deepen = scripted([cand({ threadSeed: "the stained glass" })], "deepen-model");
    const result = await proposeAndDisposeFollowUp({
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide({ narratorOptedOut: false }),
    });

    expect(result.stage).toBe("deepen");
    expect(result.origin).toBe("reflection");
    expect(result.decision.selected?.threadSeed).toBe("the stained glass");
    expect(deepen.evaluate).toHaveBeenCalledOnce();
  });

  it("opt-out omitted (undefined) behaves as false — cascade runs as before", async () => {
    const deepen = scripted([cand()], "deepen-model");
    const result = await proposeAndDisposeFollowUp({
      deepenEvaluator: deepen,
      evaluationInput: evalInput,
      decide: baseDecide(), // narratorOptedOut not set
    });
    expect(result.stage).toBe("deepen");
    expect(result.decision.selected).not.toBeNull();
    expect(deepen.evaluate).toHaveBeenCalledOnce();
  });
});
