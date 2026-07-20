/**
 * Table-driven tests for the pure Story date resolver (ADR-0026, #242), in the
 * parse-spoken-date tradition: every reference class plus the unresolvable case, and the
 * precedence date > period > circa. No DB, no LLM.
 */
import { describe, expect, it } from "vitest";
import {
  resolveStoryDate,
  type LifeEventAnchor,
  type StoryDateResolution,
} from "../src/resolve-story-date";

/** Born June 15, 1935: turns 8 in 1943, 14 in 1949, 18 in 1953. */
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

interface Case {
  name: string;
  text: string;
  birthDate?: string | null;
  lifeEvents?: LifeEventAnchor[];
  expected: StoryDateResolution;
}

const cases: Case[] = [
  // --- Stated dates ---
  {
    name: "stated full date",
    text: "We had the baby on December 25, 1943, at the old hospital.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "stated full date with ordinal day",
    text: "It was December 25th, 1943.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "stated bare year is a year-long period",
    text: "We moved to Naples in 1958.",
    birthDate: BORN_1935,
    expected: resolved("period", "1958-01-01", "1958-12-31", 'stated year "1958"'),
  },
  {
    name: "stated month and year is a month-long period",
    text: "That was December 1943, right before the cold snap.",
    birthDate: BORN_1935,
    expected: resolved("period", "1943-12-01", "1943-12-31", 'stated "December 1943"'),
  },
  {
    name: "short decade resolves to the 1900s for an elderly narrator",
    text: "Back in the 50s we listened to the radio.",
    birthDate: BORN_1935,
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "the 50s", taken as the 1950s'),
  },
  {
    name: "word decade without a birthdate defaults to the 1900s",
    text: "The fifties were good years.",
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "The fifties", taken as the 1950s'),
  },
  {
    name: "explicit four-digit decade",
    text: "In the 1950s everybody had a television.",
    birthDate: BORN_1935,
    expected: resolved("period", "1950-01-01", "1959-12-31", 'stated "the 1950s", taken as the 1950s'),
  },

  // --- Age references ---
  {
    name: "age reference is a period spanning that year of life",
    text: "When I was 8 we had a dog named Skip.",
    birthDate: BORN_1935,
    expected: resolved("period", "1943-06-15", "1944-06-14", "age 8, from birthdate"),
  },
  {
    name: "age reference with a word number",
    text: "When I was eight we had a dog named Skip.",
    birthDate: BORN_1935,
    expected: resolved("period", "1943-06-15", "1944-06-14", "age 8, from birthdate"),
  },
  {
    name: "age reference without a birthdate is unresolvable",
    text: "When I was 8 we had a dog named Skip.",
    expected: UNRESOLVABLE,
  },
  {
    name: "malformed birthdate is treated as unknown",
    text: "When I was 8 we had a dog named Skip.",
    birthDate: "1943-13-45",
    expected: UNRESOLVABLE,
  },

  // --- Grade references ---
  {
    name: "grade reference is circa birth+13/14",
    text: "In 8th grade I played trumpet.",
    birthDate: BORN_1935,
    expected: resolved("circa", "1949-06-15", null, "8th grade (age 13–14), from birthdate"),
  },
  {
    name: "grade reference with an ordinal word",
    text: "In eighth grade I played trumpet.",
    birthDate: BORN_1935,
    expected: resolved("circa", "1949-06-15", null, "8th grade (age 13–14), from birthdate"),
  },

  // --- Holiday references ---
  {
    name: "age plus holiday resolves the year (ADR-0026's example)",
    text: "When I was 8, for Christmas, I got a red bicycle.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, "age 8 at Christmas, from birthdate"),
  },
  {
    name: "holiday before the birthday in the calendar year lands the next year",
    text: "Christmas when I was 8.",
    birthDate: "1935-12-26", // turns 8 the day AFTER Christmas 1943
    expected: resolved("date", "1944-12-25", null, "age 8 at Christmas, from birthdate"),
  },
  {
    name: "movable holiday: Thanksgiving in the age year",
    text: "Thanksgiving when I was 10, the power went out.",
    birthDate: BORN_1935,
    expected: resolved("date", "1945-11-22", null, "age 10 at Thanksgiving, from birthdate"),
  },
  {
    name: "holiday plus stated year",
    text: "Christmas of 1958 we were snowed in.",
    birthDate: BORN_1935,
    expected: resolved("date", "1958-12-25", null, 'stated "Christmas 1958"'),
  },
  {
    name: "holiday alone has no year and is unresolvable",
    text: "For Christmas I got a red bicycle.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },

  // --- Anchor-relative references ---
  {
    name: "years after a life event is circa against the anchor",
    text: "We bought the farm about ten years after we married.",
    birthDate: BORN_1935,
    lifeEvents: [WEDDING_1955],
    expected: resolved("circa", "1965-04-02", null, '"about ten years after we married", from the wedding life event'),
  },
  {
    name: "years before a life event",
    text: "Two years before I graduated we moved to town.",
    birthDate: BORN_1935,
    lifeEvents: [GRADUATION_1953],
    expected: resolved("circa", "1951-06-30", null, '"Two years before I graduated", from the graduation life event'),
  },
  {
    name: "anchor-relative without the matching life event is unresolvable",
    text: "We bought the farm about ten years after we married.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },

  // --- Period language ---
  {
    name: "high school years from birthdate",
    text: "When I was in high school I worked at the five and dime.",
    birthDate: BORN_1935,
    expected: resolved("period", "1949-09-01", "1953-06-30", "high school years, from birthdate"),
  },
  {
    name: "bare 'the war' is taken as WWII when the narrator was alive for it",
    text: "During the war we rationed sugar.",
    birthDate: BORN_1935,
    expected: resolved("period", "1939-09-01", "1945-09-02", '"During the war", taken as World War II from birthdate'),
  },
  {
    name: "bare 'the war' without a birthdate is unresolvable",
    text: "During the war we rationed sugar.",
    expected: UNRESOLVABLE,
  },
  {
    name: "named war is a stated period",
    text: "He served in the Vietnam War.",
    birthDate: BORN_1935,
    expected: resolved("period", "1955-11-01", "1975-04-30", '"Vietnam", taken as 1955–1975'),
  },

  // --- Precedence: date > period > circa ---
  {
    name: "precedence: a stated date beats a derivable period",
    text: "It was December 25, 1943, my first Christmas away from home, when I was in high school.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, 'stated date "December 25, 1943"'),
  },
  {
    name: "precedence: age-at-holiday date beats the age period underneath it",
    text: "When I was 8, for Christmas, I got a red bicycle.",
    birthDate: BORN_1935,
    expected: resolved("date", "1943-12-25", null, "age 8 at Christmas, from birthdate"),
  },
  {
    name: "precedence: a stated period beats a derivable circa",
    text: "We bought the house in 1958, about ten years after we married.",
    birthDate: BORN_1935,
    lifeEvents: [WEDDING_1955],
    expected: resolved("period", "1958-01-01", "1958-12-31", 'stated year "1958"'),
  },
  {
    name: "precedence: a stated period beats a derived period",
    text: "When I was 8, in 1943, we had a radio.",
    birthDate: BORN_1935,
    expected: resolved("period", "1943-01-01", "1943-12-31", 'stated year "1943"'),
  },

  // --- Unresolvable ---
  {
    name: "no temporal reference at all",
    text: "We had a dog named Skip. He was a good dog.",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
  {
    name: "empty text",
    text: "   ",
    birthDate: BORN_1935,
    expected: UNRESOLVABLE,
  },
];

describe("resolveStoryDate (ADR-0026, #242)", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(
        resolveStoryDate({
          text: c.text,
          birthDate: c.birthDate ?? null,
          lifeEvents: c.lifeEvents ?? [],
        }),
      ).toEqual(c.expected);
    });
  }

  it("never throws, even on hostile input", () => {
    const garbage = { text: 42, birthDate: {}, lifeEvents: "nope" } as unknown as Parameters<
      typeof resolveStoryDate
    >[0];
    expect(resolveStoryDate(garbage)).toEqual(UNRESOLVABLE);
  });
});
