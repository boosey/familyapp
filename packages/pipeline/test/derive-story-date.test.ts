/**
 * Finish-time story-date backstop (ADR-0026 #246), tiered-hybrid edition.
 *
 *   - Tier A (no model): the narrator's STATED calendar auto-dates with the backstop marker.
 *   - Tier B (scripted model): soft language is recognized into a structured ref, then the PURE
 *     calculator does the math. We persist only on a confident, resolved recognition; low
 *     confidence / ambiguous / unknown types leave the story honestly Undated. The model's own ISO
 *     guess is never trusted.
 */
import { describe, expect, it } from "vitest";
import { BACKSTOP_PROVENANCE_SUFFIX, deriveStoryDate } from "../src/derive-story-date";
import { ScriptedLanguageModel } from "../src/mocks";

/** A model that always returns the given JSON (what a recognizer would emit). */
function scriptedRef(json: unknown): ScriptedLanguageModel {
  return new ScriptedLanguageModel({ respond: JSON.stringify(json) });
}

describe("deriveStoryDate — Tier A (deterministic, no model)", () => {
  it("resolves a stated year to a year-aligned period with the backstop marker", async () => {
    const out = await deriveStoryDate({ fullText: "We moved to Ohio in 1962." });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("period");
    expect(out.occurrence.date).toBe("1962-01-01");
    expect(out.occurrence.endDate).toBe("1962-12-31");
    expect(out.occurrence.provenance).toBe(`stated year "1962" ${BACKSTOP_PROVENANCE_SUFFIX}`);
  });

  it("does NOT run the model when Tier A already resolved", async () => {
    const llm = scriptedRef({ dateStatus: "resolved", confidence: "high", ref: { type: "age", age: 99 } });
    const out = await deriveStoryDate({ fullText: "It was 1962.", languageModel: llm });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.date).toBe("1962-01-01");
    expect(llm.calls).toHaveLength(0);
  });

  it("without a model, soft language stays Undated (no heuristic guess)", async () => {
    expect(await deriveStoryDate({ fullText: "When I was 8, we moved.", birthDate: "1935-06-15" })).toEqual({
      status: "unresolvable",
    });
  });
});

describe("deriveStoryDate — Tier B (model recognizer → pure calculator)", () => {
  it("recognizes an age reference, then the calculator dates it from birthDate", async () => {
    const llm = scriptedRef({ dateStatus: "resolved", confidence: "high", ref: { type: "age", age: 8 } });
    const out = await deriveStoryDate({
      fullText: "When I was 8, we moved to Cherry Street.",
      birthDate: "1935-06-15",
      languageModel: llm,
    });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("period");
    expect(out.occurrence.date).toBe("1943-06-15");
    expect(out.occurrence.endDate).toBe("1944-06-14");
    expect(out.occurrence.provenance).toBe(`age 8, from birthdate ${BACKSTOP_PROVENANCE_SUFFIX}`);
    expect(llm.calls).toHaveLength(1);
  });

  it("recognizes an anchor-relative reference and dates it from a known life event", async () => {
    const llm = scriptedRef({
      dateStatus: "resolved",
      confidence: "medium",
      ref: { type: "years_from_anchor", anchorKind: "wedding", offsetYears: 10 },
    });
    const out = await deriveStoryDate({
      fullText: "About ten years after we married, we bought the farm.",
      lifeEvents: [{ kind: "wedding", date: "1958-03-01" }],
      languageModel: llm,
    });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.kind).toBe("circa");
    expect(out.occurrence.date).toBe("1968-03-01");
    expect(out.occurrence.provenance).toContain("after the wedding");
    expect(out.occurrence.provenance).toContain(BACKSTOP_PROVENANCE_SUFFIX);
  });

  it("does NOT trust the model's own ISO guess — the calculator is the source of truth", async () => {
    const llm = scriptedRef({
      dateStatus: "resolved",
      confidence: "high",
      ref: { type: "age", age: 8, hintedOccurrence: { kind: "date", date: "1999-09-09" } },
    });
    const out = await deriveStoryDate({
      fullText: "When I was 8.",
      birthDate: "1935-06-15",
      languageModel: llm,
    });
    if (out.status !== "resolved") throw new Error("expected resolved");
    expect(out.occurrence.date).toBe("1943-06-15");
  });

  it("refuses to persist a LOW-confidence recognition", async () => {
    const llm = scriptedRef({ dateStatus: "resolved", confidence: "low", ref: { type: "age", age: 8 } });
    expect(
      await deriveStoryDate({ fullText: "When I was 8.", birthDate: "1935-06-15", languageModel: llm }),
    ).toEqual({ status: "unresolvable" });
  });

  it("refuses to persist an ambiguous recognition", async () => {
    const llm = scriptedRef({ dateStatus: "ambiguous", confidence: "high" });
    expect(
      await deriveStoryDate({ fullText: "Sometime around then.", birthDate: "1935-06-15", languageModel: llm }),
    ).toEqual({ status: "unresolvable" });
  });

  it("leaves the story Undated when the calculator cannot resolve the ref (missing anchor)", async () => {
    const llm = scriptedRef({
      dateStatus: "resolved",
      confidence: "high",
      ref: { type: "years_from_anchor", anchorKind: "wedding", offsetYears: 10 },
    });
    expect(
      await deriveStoryDate({ fullText: "Ten years after we married.", languageModel: llm }),
    ).toEqual({ status: "unresolvable" });
  });

  it("degrades a non-JSON model reply to Undated", async () => {
    const llm = new ScriptedLanguageModel({ respond: "I think it was around 1958?" });
    expect(
      await deriveStoryDate({ fullText: "When I was 8.", birthDate: "1935-06-15", languageModel: llm }),
    ).toEqual({ status: "unresolvable" });
  });
});

describe("deriveStoryDate — robustness", () => {
  it("leaves an underivable text unresolvable", async () => {
    expect(await deriveStoryDate({ fullText: "We had a dog named Biscuit." })).toEqual({
      status: "unresolvable",
    });
  });

  it("never throws on garbage input", async () => {
    expect(await deriveStoryDate({ fullText: "" })).toEqual({ status: "unresolvable" });
    expect(
      await deriveStoryDate({
        fullText: undefined as unknown as string,
        birthDate: "not-a-date",
        lifeEvents: undefined,
      }),
    ).toEqual({ status: "unresolvable" });
  });
});
