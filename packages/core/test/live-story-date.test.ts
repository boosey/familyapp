/**
 * Shared live Story date update seam (issue #321, ADR-0026).
 *
 * Owns the live-path policy both the interviewer turn-loop and the hub answer surface use:
 * Tier A stated-calendar resolve, monotonic precision ranking, and stated life-event extraction.
 * Pure — no DB, no LLM, no I/O. Callers persist through thin sinks.
 */
import { describe, expect, it } from "vitest";
import {
  OCCURRENCE_PRECISION_RANK,
  deriveLiveStoryDateUpdate,
  occurrencePrecisionRank,
} from "../src/live-story-date";

const BORN_1935 = "1935-06-15";

describe("OCCURRENCE_PRECISION_RANK", () => {
  it("ranks date > period > circa", () => {
    expect(OCCURRENCE_PRECISION_RANK.date).toBeGreaterThan(OCCURRENCE_PRECISION_RANK.period);
    expect(OCCURRENCE_PRECISION_RANK.period).toBeGreaterThan(OCCURRENCE_PRECISION_RANK.circa);
  });

  it("occurrencePrecisionRank maps null/undefined to 0", () => {
    expect(occurrencePrecisionRank(null)).toBe(0);
    expect(occurrencePrecisionRank(undefined)).toBe(0);
    expect(occurrencePrecisionRank("period")).toBe(OCCURRENCE_PRECISION_RANK.period);
  });
});

describe("deriveLiveStoryDateUpdate", () => {
  it("stated year → toPersist period + dateUnresolved false", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText:
        "It had a beautiful stained glass window in the front hall that my grandmother loved in 1958.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: 0,
    });

    expect(result.toPersist).toEqual({
      kind: "period",
      date: "1958-01-01",
      endDate: "1958-12-31",
      provenance: 'stated year "1958"',
    });
    expect(result.resultingRank).toBe(OCCURRENCE_PRECISION_RANK.period);
    expect(result.dateUnresolved).toBe(false);
  });

  it("soft age language → nothing to persist, stays unresolved", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText:
        "When I was 8, for Christmas, I got a red bicycle and rode it around the block all afternoon.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: 0,
    });

    expect(result.toPersist).toBeNull();
    expect(result.resultingRank).toBe(0);
    expect(result.dateUnresolved).toBe(true);
  });

  it("never downgrades: vaguer resolution against existing date rank persists nothing", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText: "It was December 25, 1943, and then later that year, 1943 was hard.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: OCCURRENCE_PRECISION_RANK.date,
    });

    // Tier A still resolves (to the full date in the text), but rank is not an upgrade.
    expect(result.toPersist).toBeNull();
    expect(result.resultingRank).toBe(OCCURRENCE_PRECISION_RANK.date);
    expect(result.dateUnresolved).toBe(false);
  });

  it("refines period → date when existing rank is lower", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText:
        "We opened the shop in 1951. It was December 25, 1951, when the register drawer broke.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: OCCURRENCE_PRECISION_RANK.period,
    });

    expect(result.toPersist?.kind).toBe("date");
    expect(result.toPersist?.date).toBe("1951-12-25");
    expect(result.resultingRank).toBe(OCCURRENCE_PRECISION_RANK.date);
    expect(result.dateUnresolved).toBe(false);
  });

  it("extracts stated life events from lifeEventText (utterance), not only storyText", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText: "We bought the farm and planted the north field that spring.",
      lifeEventText: "We married in 1958 and moved to the farm the next year.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: 0,
    });

    expect(result.statedLifeEvents.length).toBeGreaterThan(0);
    expect(result.statedLifeEvents.some((e) => e.kind === "wedding")).toBe(true);
    // Story text has no stated calendar → still Undated for the story itself.
    expect(result.toPersist).toBeNull();
    expect(result.dateUnresolved).toBe(true);
  });

  it("already-dated story with unresolvable text stays dateUnresolved false", () => {
    const result = deriveLiveStoryDateUpdate({
      storyText: "We had a dog named Biscuit who rode in the truck with us everywhere.",
      birthDate: BORN_1935,
      lifeEvents: [],
      existingRank: OCCURRENCE_PRECISION_RANK.period,
    });

    expect(result.toPersist).toBeNull();
    expect(result.resultingRank).toBe(OCCURRENCE_PRECISION_RANK.period);
    expect(result.dateUnresolved).toBe(false);
  });
});
