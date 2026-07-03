import { describe, expect, it } from "vitest";
import { decideFollowUp, type FollowUpDecisionInput } from "../src/behavior";
import { resolveFollowUpPolicy } from "../src/follow-up-policy";
import type { FollowUpCandidate } from "@chronicle/db";

const cand = (over: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
  ...over,
});

const base = (over: Partial<FollowUpDecisionInput> = {}): FollowUpDecisionInput => ({
  evaluation: { candidates: [cand()], modelId: "m" },
  policy: resolveFollowUpPolicy({ enabled: true }),
  answerWordCount: 40,
  followUpsAskedInThread: 0,
  followUpsAskedInSession: 0,
  distressed: false,
  offRampRequested: false,
  rapportEstablished: false,
  alreadyAskedSeeds: [],
  ...over,
});

describe("decideFollowUp", () => {
  it("selects the single confident candidate and records it as selected", () => {
    const d = decideFollowUp(base());
    expect(d.selected?.threadSeed).toBe("the stained glass window");
    expect(d.shortCircuit).toBeNull();
    expect(d.dispositions).toEqual([
      { candidate: cand(), reason: "selected", selected: true },
    ]);
  });

  it("short-circuits on distress, marking every candidate distress_shortcircuit", () => {
    const d = decideFollowUp(base({ distressed: true, evaluation: { candidates: [cand(), cand({ threadSeed: "x" })], modelId: "m" } }));
    expect(d.selected).toBeNull();
    expect(d.shortCircuit).toBe("distress_shortcircuit");
    expect(d.dispositions.map((x) => x.reason)).toEqual(["distress_shortcircuit", "distress_shortcircuit"]);
  });

  it("short-circuits on an off-ramp request", () => {
    expect(decideFollowUp(base({ offRampRequested: true })).shortCircuit).toBe("distress_shortcircuit");
  });

  it("short-circuits a thin answer below the word floor", () => {
    const d = decideFollowUp(base({ answerWordCount: 3 }));
    expect(d.shortCircuit).toBe("thin_answer");
    expect(d.selected).toBeNull();
  });

  it("short-circuits when the per-thread cap is reached", () => {
    const d = decideFollowUp(base({ followUpsAskedInThread: 2 }));
    expect(d.shortCircuit).toBe("over_cap_thread");
  });

  it("short-circuits when the per-session cap is reached", () => {
    const d = decideFollowUp(base({ followUpsAskedInSession: 4 }));
    expect(d.shortCircuit).toBe("over_cap_session");
  });

  it("vetoes an emotional candidate the narrator did not open (emotional-door rule)", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ type: "emotional", narratorOpened: false })], modelId: "m" } }));
    expect(d.selected).toBeNull();
    expect(d.dispositions[0]!.reason).toBe("emotional_door_closed");
  });

  it("allows an emotional candidate the narrator DID open", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ type: "emotional", narratorOpened: true })], modelId: "m" } }));
    expect(d.selected?.type).toBe("emotional");
  });

  it("gates a high-sensitivity candidate until rapport is established", () => {
    const hi = cand({ sensitivity: "high" });
    expect(decideFollowUp(base({ evaluation: { candidates: [hi], modelId: "m" }, rapportEstablished: false })).dispositions[0]!.reason).toBe("below_rapport");
    expect(decideFollowUp(base({ evaluation: { candidates: [hi], modelId: "m" }, rapportEstablished: true })).selected?.sensitivity).toBe("high");
  });

  it("drops a low-confidence candidate", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ confidence: 0.3 })], modelId: "m" } }));
    expect(d.dispositions[0]!.reason).toBe("below_confidence");
    expect(d.selected).toBeNull();
  });

  it("drops a candidate that repeats an already-asked seed (lexical anti-repeat)", () => {
    const d = decideFollowUp(base({ alreadyAskedSeeds: ["the STAINED glass window"] }));
    expect(d.dispositions[0]!.reason).toBe("duplicate");
    expect(d.selected).toBeNull();
  });

  it("ranks by confidence, marking the winner selected and the rest not_selected", () => {
    const lo = cand({ threadSeed: "lo", confidence: 0.7 });
    const hi = cand({ threadSeed: "hi", confidence: 0.95 });
    const d = decideFollowUp(base({ evaluation: { candidates: [lo, hi], modelId: "m" } }));
    expect(d.selected?.threadSeed).toBe("hi");
    const byReason = Object.fromEntries(d.dispositions.map((x) => [x.candidate.threadSeed, x.reason]));
    expect(byReason).toEqual({ hi: "selected", lo: "not_selected" });
  });

  it("tie-breaks equal-confidence candidates by type priority (factual over sensory)", () => {
    const factual = cand({ threadSeed: "a", type: "factual", confidence: 0.8 });
    const sensory = cand({ threadSeed: "b", type: "sensory", confidence: 0.8 });
    const d = decideFollowUp(base({ evaluation: { candidates: [sensory, factual], modelId: "m" } }));
    expect(d.selected?.threadSeed).toBe("a");
  });

  it("tie-breaks equal-confidence, equal-type candidates alphabetically by threadSeed", () => {
    const zeta = cand({ threadSeed: "zeta thread", confidence: 0.8 });
    const alpha = cand({ threadSeed: "alpha thread", confidence: 0.8 });
    const d = decideFollowUp(base({ evaluation: { candidates: [zeta, alpha], modelId: "m" } }));
    expect(d.selected?.threadSeed).toBe("alpha thread");
  });

  it("does not treat a blank/whitespace prior seed as matching every candidate", () => {
    const blank = decideFollowUp(base({ alreadyAskedSeeds: [""] }));
    expect(blank.dispositions[0]!.reason).toBe("selected");
    expect(blank.selected).not.toBeNull();

    const whitespace = decideFollowUp(base({ alreadyAskedSeeds: ["   "] }));
    expect(whitespace.dispositions[0]!.reason).toBe("selected");
    expect(whitespace.selected).not.toBeNull();
  });

  it("records the safety veto (emotional_door_closed), not duplicate, when a candidate is both", () => {
    const both = cand({
      threadSeed: "the stained glass window",
      type: "emotional",
      narratorOpened: false,
    });
    const d = decideFollowUp(
      base({
        evaluation: { candidates: [both], modelId: "m" },
        alreadyAskedSeeds: ["the stained glass window"],
      }),
    );
    expect(d.dispositions[0]!.reason).toBe("emotional_door_closed");
    expect(d.selected).toBeNull();
  });
});
