/**
 * Tests for the pure stated-life-event extractor (ADR-0026, #245) — the capture half of the
 * life-events loop. A telling that STATES an anchor fact ("we married in '58") yields the
 * reusable event; an anchor used as a REFERENCE ("ten years after we married") yields nothing;
 * anything unclear yields nothing. The extractor is conservative on purpose: a missed event
 * costs one repeated question, a wrong one silently corrupts every later derivation. No DB,
 * no LLM.
 */
import { describe, expect, it } from "vitest";
import {
  extractStatedLifeEvents,
  type StatedLifeEvent,
} from "../src/resolve-story-date";

/** Born June 15, 1935 — mirrors the resolver's own test anchor. */
const BORN_1935 = "1935-06-15";

const event = (
  kind: StatedLifeEvent["kind"],
  occurrenceKind: "date" | "period",
  date: string,
  endDate: string | null,
  provenance: string,
): StatedLifeEvent => ({
  kind,
  occurrence: { kind: occurrenceKind, date, endDate, provenance },
});

interface Case {
  name: string;
  text: string;
  birthDate?: string | null;
  expected: StatedLifeEvent[];
}

const cases: Case[] = [
  // --- Stated anchor facts ---
  {
    name: "anchor + bare year: \"we married in 1958\" → wedding, year period",
    text: "We married in 1958, at the little church on the hill.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "period", "1958-01-01", "1958-12-31", 'stated "married in 1958" in a telling'),
    ],
  },
  {
    name: "anchor + 2-digit year: \"we married in '58\" → 1958 (1900s from a 1935 birth)",
    text: "We married in '58, the year the old barn burned.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "period", "1958-01-01", "1958-12-31", 'stated "married in \'58" in a telling'),
    ],
  },
  {
    name: "anchor + full date: \"married on June 2, 1955\" → exact date",
    text: "We married on June 2, 1955 at the little church, and it rained all day.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "date", "1955-06-02", null, 'stated "married on June 2, 1955" in a telling'),
    ],
  },
  {
    name: "anchor + month-year: \"graduated in June 1961\" → month period",
    text: "I graduated in June 1961, third in my class, and my mother cried.",
    birthDate: BORN_1935,
    expected: [
      event("graduation", "period", "1961-06-01", "1961-06-30", 'stated "graduated in June 1961" in a telling'),
    ],
  },
  {
    name: "date before the anchor pairs too: \"In 1958 we got married\"",
    text: "In 1958 we got married, and Henry wore his uniform.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "period", "1958-01-01", "1958-12-31", 'stated "1958 we got married" in a telling'),
    ],
  },
  {
    name: "2-digit year century follows the birth anchor: born 1985, \"married in '12\" → 2012",
    text: "We married in '12, right after college.",
    birthDate: "1985-04-01",
    expected: [
      event("wedding", "period", "2012-01-01", "2012-12-31", 'stated "married in \'12" in a telling'),
    ],
  },
  {
    name: "each anchor pairs its own date: \"married in '58 … graduated in '61\"",
    text: "We married in '58 and I graduated in '61, so those were busy years.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "period", "1958-01-01", "1958-12-31", 'stated "married in \'58" in a telling'),
      event("graduation", "period", "1961-01-01", "1961-12-31", 'stated "graduated in \'61" in a telling'),
    ],
  },
  {
    name: "same kind twice with different dates keeps both (a second marriage)",
    text: "We married in '55, and after Henry passed we married again in '63.",
    birthDate: BORN_1935,
    expected: [
      event("wedding", "period", "1955-01-01", "1955-12-31", 'stated "married in \'55" in a telling'),
      event("wedding", "period", "1963-01-01", "1963-12-31", 'stated "married again in \'63" in a telling'),
    ],
  },
  {
    name: "service vocabulary: \"enlisted in the army in 1950\" → one event (anchor words dedupe)",
    text: "He enlisted in the army in 1950, right out of high school.",
    birthDate: BORN_1935,
    expected: [
      event("military_service", "period", "1950-01-01", "1950-12-31", 'stated "enlisted in the army in 1950" in a telling'),
    ],
  },
  {
    name: "a move: \"we moved to Ohio in '58\"",
    text: "We moved to Ohio in '58 with the baby and two suitcases.",
    birthDate: BORN_1935,
    expected: [
      event("move", "period", "1958-01-01", "1958-12-31", 'stated "moved to Ohio in \'58" in a telling'),
    ],
  },

  // --- Reference, not fact: nothing captured ---
  {
    name: "anchor-relative reference records nothing (\"ten years after we married … in 1968\")",
    text: "About ten years after we married, we bought the farm in 1968.",
    birthDate: BORN_1935,
    expected: [],
  },
  {
    name: "the guard holds even with a date right after the anchor (conservative miss)",
    text: "Ten years after we married in 1958 we bought the farm.",
    birthDate: BORN_1935,
    expected: [],
  },
  {
    name: "a sentence boundary severs the pairing (\"We married young. In 1968…\")",
    text: "We married young. In 1968 we bought the farm.",
    birthDate: BORN_1935,
    expected: [],
  },
  {
    name: "an anchor with no date records nothing (\"married at the little church\")",
    text: "We married at the little church on the hill, the one with the red door.",
    birthDate: BORN_1935,
    expected: [],
  },
  {
    name: "a bare date with no anchor records nothing (\"we bought the farm in 1968\")",
    text: "We bought the farm in 1968 and planted the whole north field that spring.",
    birthDate: BORN_1935,
    expected: [],
  },
  {
    name: "no birthdate still captures 4-digit years and defaults '58 to the 1900s",
    text: "We married in '58.",
    birthDate: null,
    expected: [
      event("wedding", "period", "1958-01-01", "1958-12-31", 'stated "married in \'58" in a telling'),
    ],
  },
  {
    name: "a 2-digit year that would predate the narrator's birth is dropped (born 1955, \"'50\")",
    text: "We married in '50, the happiest day of my life.",
    birthDate: "1955-06-15",
    expected: [],
  },
];

describe("extractStatedLifeEvents", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(
        extractStatedLifeEvents({ text: c.text, birthDate: c.birthDate }),
      ).toEqual(c.expected);
    });
  }

  it("never throws and extracts nothing on empty or malformed input", () => {
    expect(extractStatedLifeEvents({ text: "" })).toEqual([]);
    expect(extractStatedLifeEvents({ text: "   " })).toEqual([]);
    expect(extractStatedLifeEvents(null as never)).toEqual([]);
    expect(extractStatedLifeEvents({ text: 42 as never })).toEqual([]);
  });
});
