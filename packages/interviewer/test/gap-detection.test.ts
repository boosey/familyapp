import { describe, expect, it } from "vitest";
import { ScriptedLanguageModel } from "@chronicle/pipeline";
import {
  extractGaps,
  parseGaps,
  gapsToFollowUpCandidates,
  type Gap,
} from "../src/gap-detection";
import { resolveGapPrompt } from "../src/prompts/gap-prompts";
import { GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE } from "../src/constants";

const gap = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "temporal",
  seed: "the year they moved",
  sensitivity: "low",
  narratorOpened: false,
  ...over,
});

describe("parseGaps", () => {
  it("parses a fenced ```json block and a raw block", () => {
    const payload = { gaps: [gap()] };
    expect(parseGaps("```json\n" + JSON.stringify(payload) + "\n```")).toHaveLength(1);
    const out = parseGaps(JSON.stringify(payload));
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("temporal");
    expect(out[0]!.seed).toBe("the year they moved");
  });

  it("drops entries with a bad kind/sensitivity or missing/blank seed", () => {
    const out = parseGaps(
      JSON.stringify({
        gaps: [
          gap(), // valid
          gap({ kind: "philosophical" }), // bad kind
          gap({ sensitivity: "extreme" }), // bad sensitivity
          gap({ seed: "   " }), // blank seed
          gap({ seed: 42 }), // non-string seed
          { kind: "temporal", sensitivity: "low" }, // missing seed
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.seed).toBe("the year they moved");
  });

  it("normalizes narratorOpened to a strict boolean", () => {
    const out = parseGaps(
      JSON.stringify({
        gaps: [
          gap({ seed: "opened", narratorOpened: true }),
          gap({ seed: "truthy", narratorOpened: "yes" }),
          gap({ seed: "missing", narratorOpened: undefined }),
        ],
      }),
    );
    const bySeed = Object.fromEntries(out.map((g) => [g.seed, g.narratorOpened]));
    expect(bySeed).toEqual({ opened: true, truthy: false, missing: false });
  });

  it("caps the number of gaps returned (GAP_DETECTION_MAX_GAPS)", () => {
    const many = Array.from({ length: 10 }, (_, i) => gap({ seed: `gap ${i}` }));
    const out = parseGaps(JSON.stringify({ gaps: many }));
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("returns [] on non-JSON text or a non-array `gaps`", () => {
    expect(parseGaps("nothing was missing")).toEqual([]);
    expect(parseGaps(JSON.stringify({ gaps: "nope" }))).toEqual([]);
    expect(parseGaps(JSON.stringify({}))).toEqual([]);
  });
});

describe("extractGaps", () => {
  it("sends the resolved prompt-as-data system message and parses the gaps", async () => {
    const scripted = { gaps: [gap({ kind: "relational", seed: "who else was there" })] };
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify(scripted) });
    const res = await extractGaps(llm, {
      questionText: "Tell me about your first job.",
      answerTranscript:
        "I started at the cannery down by the harbor the summer everything changed for us.",
    });
    expect(res.gaps).toHaveLength(1);
    expect(res.gaps[0]!.kind).toBe("relational");
    expect(res.modelId).toBe("mock-claude");

    // The system message the mock received must BE the versioned prompt-data string — proving the
    // wording is resolved from data, not inlined.
    const sys = llm.calls[0]!.messages.find((m) => m.role === "system")!.content;
    expect(sys).toBe(resolveGapPrompt().systemPrompt);
    expect(llm.calls[0]!.responseFormat).toBe("json");
  });

  it("resolves a pinned prompt version/vendor and reports it on the result", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify({ gaps: [] }) });
    const res = await extractGaps(
      llm,
      { questionText: "q", answerTranscript: "a ".repeat(20) },
      { vendor: "anthropic", version: "v1" },
    );
    // anthropic has no override → falls back to default, and the result records where it resolved.
    expect(res.promptVersion).toBe("v1");
    expect(res.promptVendor).toBe("default");
  });

  it("drops gracefully to an empty gap set on malformed model output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "I could not find any gaps." });
    const res = await extractGaps(llm, {
      questionText: "q",
      answerTranscript: "a genuinely long enough answer to warrant a detection pass here today.",
    });
    expect(res.gaps).toEqual([]);
  });
});

describe("gapsToFollowUpCandidates", () => {
  it("maps each gap kind to a FollowUpType and assigns the tuned confidence", () => {
    const gaps: Gap[] = [
      { kind: "temporal", seed: "when", sensitivity: "low", narratorOpened: false },
      { kind: "relational", seed: "who", sensitivity: "medium", narratorOpened: true },
      { kind: "spatial", seed: "where", sensitivity: "low", narratorOpened: false },
      { kind: "causal", seed: "why", sensitivity: "high", narratorOpened: true },
      { kind: "identity", seed: "which", sensitivity: "low", narratorOpened: false },
    ];
    const cands = gapsToFollowUpCandidates(gaps);
    expect(cands.map((c) => c.type)).toEqual([
      "temporal",
      "relational",
      "factual",
      "factual",
      "factual",
    ]);
    // sensitivity + narratorOpened pass through unchanged (the existing gates rely on them).
    expect(cands[3]).toMatchObject({ sensitivity: "high", narratorOpened: true });
    for (const c of cands) expect(c.confidence).toBe(GAP_FOLLOW_UP_CANDIDATE_CONFIDENCE);
  });

  it("never emits an `emotional` candidate — gap follow-ups are factual by construction", () => {
    const cands = gapsToFollowUpCandidates([
      { kind: "causal", seed: "why", sensitivity: "high", narratorOpened: false },
    ]);
    expect(cands.every((c) => c.type !== "emotional")).toBe(true);
  });
});
