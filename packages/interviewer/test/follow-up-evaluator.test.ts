import { describe, expect, it } from "vitest";
import { parseCandidates } from "../src/follow-up-evaluator";

const one = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
  ...over,
});

describe("parseCandidates", () => {
  it("parses a fenced ```json block", () => {
    const text = "```json\n" + JSON.stringify({ candidates: [one()] }) + "\n```";
    const out = parseCandidates(text);
    expect(out).toHaveLength(1);
    expect(out[0]!.threadSeed).toBe("the stained glass window");
    expect(out[0]!.type).toBe("sensory");
  });

  it("parses raw (unfenced) JSON", () => {
    const out = parseCandidates(JSON.stringify({ candidates: [one()] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.9);
  });

  it("drops entries with a bad enum value or missing/blank seed", () => {
    const out = parseCandidates(
      JSON.stringify({
        candidates: [
          one(), // valid
          one({ type: "philosophical" }), // bad type
          one({ sensitivity: "extreme" }), // bad sensitivity
          one({ threadSeed: "   " }), // blank seed
          one({ threadSeed: 42 }), // non-string seed
          { type: "sensory", sensitivity: "low", confidence: 0.5 }, // missing seed
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.threadSeed).toBe("the stained glass window");
  });

  it("clamps confidence to [0,1] and coerces non-numbers to 0", () => {
    const out = parseCandidates(
      JSON.stringify({
        candidates: [
          one({ threadSeed: "high", confidence: 1.5 }),
          one({ threadSeed: "low", confidence: -0.2 }),
          one({ threadSeed: "nan", confidence: "x" }),
        ],
      }),
    );
    const bySeed = Object.fromEntries(out.map((c) => [c.threadSeed, c.confidence]));
    expect(bySeed).toEqual({ high: 1, low: 0, nan: 0 });
  });

  it("normalizes narratorOpened to a strict boolean", () => {
    const out = parseCandidates(
      JSON.stringify({
        candidates: [
          one({ threadSeed: "opened", narratorOpened: true }),
          one({ threadSeed: "truthy", narratorOpened: "yes" }),
          one({ threadSeed: "missing" }),
        ],
      }),
    );
    const bySeed = Object.fromEntries(out.map((c) => [c.threadSeed, c.narratorOpened]));
    expect(bySeed).toEqual({ opened: true, truthy: false, missing: false });
  });

  it("returns [] on non-JSON text", () => {
    expect(parseCandidates("I could not find anything to ask about.")).toEqual([]);
  });

  it("returns [] when `candidates` is not an array", () => {
    expect(parseCandidates(JSON.stringify({ candidates: "nope" }))).toEqual([]);
    expect(parseCandidates(JSON.stringify({}))).toEqual([]);
    expect(parseCandidates(JSON.stringify([one()]))).toEqual([]);
  });
});
