/**
 * Table-driven tests for the tiered-hybrid Story date resolver (ADR-0026).
 *
 *   - Tier A (`resolveStatedStoryDate`): the NARROW deterministic parse of the stated calendar
 *     ONLY. The deleted heuristics (bare age/grade/holiday-at-age math, bare "the war", the short
 *     "the 50s" century guess, word decades, anchor-relative math) must now come back UNRESOLVABLE
 *     here — they are the source of confidently-wrong Timeline placement and are gone.
 *   - Tier B (`resolveTemporalRef`): the pure calculator over a VALIDATED structured ref. All the
 *     age/holiday/anchor/era/season math lives here now, gated on a real anchor.
 *   - `parseTemporalProposal`: the defensive parser from LLM JSON → validated proposal.
 *
 * No DB, no LLM, no clock.
 */
import { describe, expect, it } from "vitest";
import {
  parseTemporalProposal,
  resolveStatedStoryDate,
  resolveTemporalRef,
  type LifeEventAnchor,
  type StoryDateResolution,
  type TemporalRef,
} from "../src/resolve-story-date";

/** Born June 15, 1935: turns 8 in 1943, 10 in 1945, 14 in 1949, 18 in 1953. */
const BORN_1935 = "1935-06-15";
const WEDDING_1955: LifeEventAnchor = { kind: "wedding", date: "1955-04-02" };
const GRADUATION_1953: LifeEventAnchor = { kind: "graduation", date: "1953-06-30" };

const resolved = (
  kind: "date" | "circa" | "period",
  date: string,
  endDate: string | null,
  provenance: string,
): StoryDateResolution => ({
  status: "resolved",
  occurrence: { kind, date, endDate, provenance },
});

const UNRESOLVABLE: StoryDateResolution = { status: "unresolvable" };

// ===========================================================================
// Tier A — stated calendar ONLY
// ===========================================================================

interface TierACase {
  name: string;
  text: string;
  birthDate?: string | null;
  lifeEvents?: LifeEventAnchor[];
  expected: StoryDateResolution;
}

const tierA: TierACase[] = [
  // --- Stated calendar forms RESOLVE ---
  {
    name: "stated full date",
    text: "We had the baby on December 25, 1943, at the old hospital.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "stated full date with ordinal day",
    text: "It was December 25th, 1943.",
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "day-first full date",
    text: "On 25 December 1943 the war felt far away.",
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "stated bare year is a year-long period",
    text: "We moved to Naples in 1958.",
    expected: resolved("period", "1958-01-01", "1958-12-31", 'stated year "1958"'),
  },
  {
    name: "stated month and year is a month-long period",
    text: "That was December 1943, right before the cold snap.",
    expected: resolved("period", "1943-12-01", "1943-12-31", 'stated "December 1943"'),
  },
  {
    name: "explicit four-digit decade",
    text: "In the 1950s everybody had a television.",
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "the 1950s"'),
  },
  {
    name: "explicit four-digit decade without 'the'",
    text: "1950s living rooms all looked the same.",
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "the 1950s"'),
  },

  // --- Deleted heuristics must be UNRESOLVABLE now ---
  {
    name: "DELETED: short decade 'the 50s' no longer century-guesses",
    text: "Back in the 50s we listened to the radio.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: word decade 'the fifties' no longer resolves",
    text: "The fifties were good years.",
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: bare age no longer auto-persists on the live path",
    text: "When I was 8 we had a dog named Skip.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: grade no longer auto-persists",
    text: "In 8th grade I played trumpet.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: bare 'the war' is not silently WWII",
    text: "During the war we rationed sugar.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: named war place-name is not a stated period in Tier A",
    text: "He served in the Vietnam War.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: anchor-relative math is not Tier A",
    text: "We bought the farm about ten years after we married.",
    birthDate: BORN_1935,
    lifeEvents: [WEDDING_1955],
    expected: UNRESOLVABLE,
  },
  {
    name: "DELETED: high school life-stage is not Tier A",
    text: "When I was in high school I worked at the five and dime.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "holiday alone is unresolvable",
    text: "For Christmas I got a red bicycle.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },

  // --- Precedence & mixed language (Tier A still wins on the stated calendar) ---
  {
    name: "a stated date beats surrounding relative language",
    text: "It was December 25, 1943, my first Christmas away, when I was in high school.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "a stated year is picked out of otherwise-relative text",
    text: "When I was 8, in 1943, we had a radio.",
    birthDate: BORN_1935,
    expected: resolved("period", "1943-01-01", "1943-12-31", 'stated year "1943"'),
  },
  {
    name: "'Christmas of 1958' resolves to the stated year (holiday math is Tier B)",
    text: "Christmas of 1958 we were snowed in.",
    expected: resolved("period", "1958-01-01", "1958-12-31", 'stated year "1958"'),
  },

  // --- Nothing stated ---
  {
    name: "no temporal reference at all",
    text: "We had a dog named Skip. He was a good dog.",
    expected: UNRESOLVABLE,
  },
  { name: "empty text", text: "   ", expected: UNRESOLVABLE },
];

describe("resolveStatedStoryDate — Tier A (stated calendar only)", () => {
  for (const c of tierA) {
    it(c.name, () => {
      expect(
        resolveStatedStoryDate({
          text: c.text,
          birthDate: c.birthDate ?? null,
          lifeEvents: c.lifeEvents ?? [],
        }),
      ).toEqual(c.expected);
    });
  }

  it("never throws, even on hostile input", () => {
    const garbage = { text: 42, birthDate: {}, lifeEvents: "nope" } as unknown as Parameters<
      typeof resolveStatedStoryDate
    >[0];
    expect(resolveStatedStoryDate(garbage)).toEqual(UNRESOLVABLE);
  });
});

// ===========================================================================
// Tier B — pure calculator over a validated ref
// ===========================================================================

interface TierBCase {
  name: string;
  ref: TemporalRef;
  birthDate?: string | null;
  lifeEvents?: LifeEventAnchor[];
  expected: StoryDateResolution;
}

const tierB: TierBCase[] = [
  {
    name: "age → period spanning that year of life",
    ref: { type: "age", age: 8 },
    birthDate: BORN_1935,
    expected: resolved("period", "1943-06-15", "1944-06-14", "age 8, from birthdate"),
  },
  {
    name: "hedged age → circa on the birthday",
    ref: { type: "age", age: 8, hedge: true },
    birthDate: BORN_1935,
    expected: resolved("circa", "1943-06-15", null, "around age 8, from birthdate"),
  },
  {
    name: "age without a birthdate is unresolvable",
    ref: { type: "age", age: 8 },
    expected: UNRESOLVABLE,
  },
  {
    name: "malformed birthdate is treated as unknown",
    ref: { type: "age", age: 8 },
    birthDate: "1943-13-45",
    expected: UNRESOLVABLE,
  },
  {
    name: "grade → circa at birth+13/14",
    ref: { type: "grade", grade: 8 },
    birthDate: BORN_1935,
    expected: resolved("circa", "1949-06-15", null, "8th grade (age 13–14), from birthdate"),
  },
  {
    name: "holiday at age → the exact holiday date in the age year",
    ref: { type: "holiday_at_age", holiday: "christmas", age: 8 },
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, "age 8 at Christmas, from birthdate"),
  },
  {
    name: "holiday before the birthday lands the next calendar year",
    ref: { type: "holiday_at_age", holiday: "christmas", age: 8 },
    birthDate: "1935-12-26",
    expected: resolved("date", "1944-12-25", null, "age 8 at Christmas, from birthdate"),
  },
  {
    name: "movable holiday: Thanksgiving in the age year",
    ref: { type: "holiday_at_age", holiday: "thanksgiving", age: 10 },
    birthDate: BORN_1935,
    expected: resolved("date", "1945-11-22", null, "age 10 at Thanksgiving, from birthdate"),
  },
  {
    // Born Nov 24, 1939: on Thanksgiving 1949 (Nov 24) they turn exactly 10 THAT day. A hard-coded
    // Nov-22 birthday probe would wrongly skip to 1950; the movable-day computation keeps 1949.
    name: "movable holiday: a late-November birthday keeps the correct year (boundary)",
    ref: { type: "holiday_at_age", holiday: "thanksgiving", age: 10 },
    birthDate: "1939-11-24",
    expected: resolved("date", "1949-11-24", null, "age 10 at Thanksgiving, from birthdate"),
  },
  {
    name: "holiday in a stated year",
    ref: { type: "holiday_in_year", holiday: "christmas", year: 1958 },
    expected: resolved("date", "1958-12-25", null, 'stated "Christmas 1958"'),
  },
  {
    name: "hedged holiday in a year → circa",
    ref: { type: "holiday_in_year", holiday: "christmas", year: 1958, hedge: true },
    expected: resolved("circa", "1958-12-25", null, 'stated "Christmas 1958"'),
  },
  {
    name: "month at age → the month-long period in the age year",
    ref: { type: "month_at_age", month: 12, age: 8 },
    birthDate: BORN_1935,
    expected: resolved("period", "1943-12-01", "1943-12-31", "December at age 8, from birthdate"),
  },
  {
    name: "years after a life event → circa against the anchor",
    ref: { type: "years_from_anchor", anchorKind: "wedding", offsetYears: 10 },
    birthDate: BORN_1935,
    lifeEvents: [WEDDING_1955],
    expected: resolved("circa", "1965-04-02", null, "10 years after the wedding, from that life event"),
  },
  {
    name: "years before a life event → circa against the anchor",
    ref: { type: "years_from_anchor", anchorKind: "graduation", offsetYears: -2 },
    lifeEvents: [GRADUATION_1953],
    expected: resolved("circa", "1951-06-30", null, "2 years before the graduation, from that life event"),
  },
  {
    name: "anchor-relative without the matching life event is unresolvable",
    ref: { type: "years_from_anchor", anchorKind: "wedding", offsetYears: 10 },
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "life stage → the schooling-years period",
    ref: { type: "life_stage", lifeStage: "high_school" },
    birthDate: BORN_1935,
    expected: resolved("period", "1949-09-01", "1953-06-30", "high school years, from birthdate"),
  },
  {
    name: "named era → the fixed era span",
    ref: { type: "named_era", era: "vietnam" },
    expected: resolved("period", "1955-11-01", "1975-04-30", "the Vietnam War, taken as 1955–1975"),
  },
  {
    name: "season in a stated year → the season period",
    ref: { type: "season_in_year", season: "summer", year: 1958 },
    expected: resolved("period", "1958-06-01", "1958-08-31", 'stated "summer 1958"'),
  },
  {
    name: "winter at age crosses the year boundary",
    ref: { type: "season_at_age", season: "winter", age: 10 },
    birthDate: BORN_1935,
    expected: resolved("period", "1945-12-01", "1946-02-28", "winter at age 10, from birthdate"),
  },
  {
    name: "stated full date via the calculator",
    ref: { type: "stated_full_date", year: 1943, month: 12, day: 25 },
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "stated decade via the calculator",
    ref: { type: "stated_decade", decadeStartYear: 1950 },
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "the 1950s"'),
  },
  {
    name: "the model's hintedOccurrence is IGNORED — the calculator owns the date",
    ref: { type: "age", age: 8, hintedOccurrence: { kind: "date", date: "1999-01-01" } },
    birthDate: BORN_1935,
    expected: resolved("period", "1943-06-15", "1944-06-14", "age 8, from birthdate"),
  },

  // --- Validation: out-of-range / bad slots are unresolvable, never invented ---
  {
    name: "impossible age is unresolvable",
    ref: { type: "age", age: 200 },
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "out-of-range grade is unresolvable",
    ref: { type: "grade", grade: 15 },
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "holiday in a nonsense year is unresolvable",
    ref: { type: "holiday_in_year", holiday: "christmas", year: 12 },
    expected: UNRESOLVABLE,
  },
];

describe("resolveTemporalRef — Tier B (pure calculator)", () => {
  for (const c of tierB) {
    it(c.name, () => {
      expect(
        resolveTemporalRef({
          ref: c.ref,
          birthDate: c.birthDate ?? null,
          lifeEvents: c.lifeEvents ?? [],
        }),
      ).toEqual(c.expected);
    });
  }

  it("never throws, even on hostile input", () => {
    const garbage = { ref: 42, birthDate: {}, lifeEvents: "nope" } as unknown as Parameters<
      typeof resolveTemporalRef
    >[0];
    expect(resolveTemporalRef(garbage)).toEqual(UNRESOLVABLE);
  });
});

// ===========================================================================
// Defensive parser — LLM JSON → validated TemporalProposal
// ===========================================================================

describe("parseTemporalProposal — defensive LLM parse", () => {
  it("parses a well-formed resolved proposal", () => {
    const out = parseTemporalProposal(
      JSON.stringify({ dateStatus: "resolved", confidence: "high", ref: { type: "age", age: 8 } }),
    );
    expect(out).toEqual({ dateStatus: "resolved", confidence: "high", ref: { type: "age", age: 8 } });
  });

  it("tolerates a ```json fenced block", () => {
    const out = parseTemporalProposal(
      '```json\n{"dateStatus":"resolved","confidence":"medium","ref":{"type":"stated_year","year":1958}}\n```',
    );
    expect(out).toEqual({
      dateStatus: "resolved",
      confidence: "medium",
      ref: { type: "stated_year", year: 1958 },
    });
  });

  it("drops an unknown ref type to unresolvable", () => {
    const out = parseTemporalProposal(
      JSON.stringify({ dateStatus: "resolved", confidence: "high", ref: { type: "vibes" } }),
    );
    expect(out).toEqual({ dateStatus: "unresolvable", confidence: "high" });
  });

  it("drops an unknown holiday from the allowlist but keeps the ref shell", () => {
    const out = parseTemporalProposal(
      JSON.stringify({
        dateStatus: "resolved",
        confidence: "high",
        ref: { type: "holiday_in_year", holiday: "arbor_day", year: 1958 },
      }),
    );
    expect(out).toEqual({
      dateStatus: "resolved",
      confidence: "high",
      ref: { type: "holiday_in_year", year: 1958 },
    });
  });

  it("keeps low confidence so the caller can gate on it", () => {
    const out = parseTemporalProposal(
      JSON.stringify({ dateStatus: "resolved", confidence: "low", ref: { type: "age", age: 8 } }),
    );
    expect(out).toEqual({ dateStatus: "resolved", confidence: "low", ref: { type: "age", age: 8 } });
  });

  it("preserves an ambiguous verdict and omits the ref", () => {
    const out = parseTemporalProposal(
      JSON.stringify({ dateStatus: "ambiguous", confidence: "medium", ref: { type: "age", age: 8 } }),
    );
    expect(out).toEqual({ dateStatus: "ambiguous", confidence: "medium" });
  });

  it("degrades non-JSON to unresolvable/low", () => {
    expect(parseTemporalProposal("I think it was around 1958?")).toEqual({
      dateStatus: "unresolvable",
      confidence: "low",
    });
  });
});
