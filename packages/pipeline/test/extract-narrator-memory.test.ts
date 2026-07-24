import { describe, expect, it } from "vitest";
import {
  extractNarratorMemory,
  type ExtractedMemory,
} from "../src/extract-narrator-memory";
import { ScriptedLanguageModel } from "../src/mocks";

function memory(overrides: Partial<ExtractedMemory> = {}): ExtractedMemory {
  return { title: "t", summary: "s", tags: [], confidence: 0.5, ...overrides };
}

describe("extractNarratorMemory", () => {
  it("parses a valid JSON array into ExtractedMemory[] with correct fields", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify([
        { title: "Grew up in New Orleans", summary: "Childhood home.", tags: ["place"], confidence: 0.9 },
      ]),
    });
    const r = await extractNarratorMemory("I grew up in New Orleans.", llm);
    expect(r).toEqual([
      { title: "Grew up in New Orleans", summary: "Childhood home.", tags: ["place"], confidence: 0.9 },
    ]);
  });

  it("parses multiple facts", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify([
        memory({ title: "Fact one" }),
        memory({ title: "Fact two" }),
        memory({ title: "Fact three" }),
      ]),
    });
    const r = await extractNarratorMemory("some transcript", llm);
    expect(r.map((m) => m.title)).toEqual(["Fact one", "Fact two", "Fact three"]);
  });

  it("returns [] on garbage / non-JSON output", async () => {
    const llm = new ScriptedLanguageModel({ respond: "not json at all {" });
    expect(await extractNarratorMemory("...", llm)).toEqual([]);
  });

  it("returns [] on an empty response", async () => {
    const llm = new ScriptedLanguageModel({ respond: "" });
    expect(await extractNarratorMemory("...", llm)).toEqual([]);
  });

  it("returns [] when the JSON is an object, not an array", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify({ title: "x", summary: "y", tags: [], confidence: 1 }),
    });
    expect(await extractNarratorMemory("...", llm)).toEqual([]);
  });

  it("short-circuits to [] on empty/whitespace input WITHOUT calling the llm", async () => {
    const llm = new ScriptedLanguageModel({ respond: JSON.stringify([memory()]) });
    expect(await extractNarratorMemory("", llm)).toEqual([]);
    expect(await extractNarratorMemory("   \n\t ", llm)).toEqual([]);
    expect(llm.calls.length).toBe(0);
  });

  it("drops malformed elements, keeping only the valid ones", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify([
        memory({ title: "keep me" }),
        { title: "", summary: "empty title", tags: [], confidence: 0.5 }, // empty title -> dropped
        { title: "no summary", tags: [], confidence: 0.5 }, // missing summary -> dropped
        { summary: "no title", tags: [], confidence: 0.5 }, // missing title -> dropped
        "just a string", // not an object -> dropped
        null, // null -> dropped
        ["array"], // array -> dropped
        memory({ title: "keep me too" }),
      ]),
    });
    const r = await extractNarratorMemory("...", llm);
    expect(r.map((m) => m.title)).toEqual(["keep me", "keep me too"]);
  });

  it("coerces missing/non-array tags to [] and keeps only string tag entries", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify([
        { title: "no tags key", summary: "s", confidence: 0.5 },
        { title: "tags not array", summary: "s", tags: "oops", confidence: 0.5 },
        { title: "mixed tags", summary: "s", tags: ["ok", 3, null, "fine"], confidence: 0.5 },
      ]),
    });
    const r = await extractNarratorMemory("...", llm);
    expect(r[0]?.tags).toEqual([]);
    expect(r[1]?.tags).toEqual([]);
    expect(r[2]?.tags).toEqual(["ok", "fine"]);
  });

  it("defaults missing/non-number confidence to 0 and clamps out-of-range values", async () => {
    const llm = new ScriptedLanguageModel({
      respond: JSON.stringify([
        { title: "missing", summary: "s", tags: [] },
        { title: "non-number", summary: "s", tags: [], confidence: "high" },
        { title: "too high", summary: "s", tags: [], confidence: 5 },
        { title: "too low", summary: "s", tags: [], confidence: -2 },
        { title: "nan", summary: "s", tags: [], confidence: Number.NaN },
        { title: "in range", summary: "s", tags: [], confidence: 0.42 },
      ]),
    });
    const r = await extractNarratorMemory("...", llm);
    expect(r.map((m) => m.confidence)).toEqual([0, 0, 1, 0, 0, 0.42]);
  });
});
