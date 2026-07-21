/**
 * Story date resolver (ADR-0026, tiered hybrid) — turns a telling's temporal language into one of
 * the three Story date forms (`date | period | circa`), with a plain-language provenance note.
 *
 * The split of labor is BINDING (see docs/superpowers/specs/2026-07-21-dates-gaps-richness-
 * reconciliation.md and ADR-0026):
 *
 *   - **Tier A — `resolveStatedStoryDate`**: a NARROW deterministic parse of the *stated calendar*
 *     only — full dates ("December 25, 1943"), month+year ("December 1943"), bare year ("1958"),
 *     and explicit four-digit decades ("the 1950s"). It NEVER guesses: no relative ages, no
 *     grade/holiday/anchor math, no bare place-names, no bare "the war", no ambiguous "the 50s"
 *     century guess. Those were silent regex write-authority in the earlier resolver and are the
 *     source of confidently-wrong Timeline placement; they are DELETED here.
 *
 *   - **Tier B — `resolveTemporalRef`**: a PURE calculator that turns a *validated* structured
 *     `TemporalRef` (which an LLM recognizes from soft language) plus `(birthDate, lifeEvents)`
 *     into an occurrence — age/holiday/anchor/grade/life-stage/named-era/season math. The LLM only
 *     RECOGNIZES and emits the ref; this code does the arithmetic and alone decides the form. An
 *     LLM-emitted ISO occurrence is NEVER trusted (the `hintedOccurrence` field is ignored here).
 *
 * Both are pure: no DB, no LLM, no clock, and they NEVER throw — anything underivable comes back
 * `{ status: "unresolvable" }`, never an exception and never an invented date. Precision is never
 * invented: a bare year is a year-long period, "about"/hedged language is `circa`, and an age or
 * grade alone is a period/circa, never a fake day.
 *
 * This module also holds `extractStatedLifeEvents` (issue #245) — the capture half of the
 * life-events loop, which spots a STATED anchor fact ("we married in '58") to store as a reusable
 * event. Same discipline: tolerant, never throws, never invents; conservative because a wrong
 * anchor silently corrupts later derivations.
 */
import type { LifeEventKind, OccurredKind } from "@chronicle/db";
import { isRealCalendarDate, toIsoDate } from "./person-dob";

/** A known life event offered as an anchor, pared to what derivation needs. */
export interface LifeEventAnchor {
  kind: LifeEventKind;
  /** ISO calendar date (YYYY-MM-DD): the event's point, or its span start for a period. */
  date: string;
}

export interface ResolveStoryDateInput {
  /** The telling itself — transcript or prose. */
  text: string;
  /** The narrator's birth date (ISO YYYY-MM-DD) — the primary anchor. Malformed/absent = unknown. */
  birthDate?: string | null;
  /** Known life events — the reusable anchors for relative references. */
  lifeEvents?: LifeEventAnchor[];
}

/** A resolved Story date: the form, the point/span-start, the span end (period only), provenance. */
export interface StoryDateOccurrence {
  kind: OccurredKind;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  /** ISO calendar date — set only for `period`. */
  endDate: string | null;
  /** Plain-language note naming the derivation, e.g. "age 8 at Christmas, from birthdate". */
  provenance: string;
}

export type StoryDateResolution =
  | { status: "resolved"; occurrence: StoryDateOccurrence }
  | { status: "unresolvable" };

const UNRESOLVABLE: StoryDateResolution = { status: "unresolvable" };

// ===========================================================================
// Tier B contract — structured temporal references (ADR-0026 §4.3).
// An LLM recognizes soft temporal language and emits ONE of these; the calculator below does the
// math. Allowlists are CLOSED and owned by the calculator — an unknown value is treated as
// unresolvable, never invented at runtime.
// ===========================================================================

export type HolidayId =
  | "christmas_eve"
  | "christmas"
  | "new_years_eve"
  | "new_years_day"
  | "halloween"
  | "valentines_day"
  | "fourth_of_july"
  | "thanksgiving";

export type LifeStageId =
  | "elementary_school" // ~age 5–11
  | "middle_school" // ~age 11–14
  | "high_school" // ~age 14–18 (Sep 14 → Jun 18)
  | "college"; // ~age 18–22

/** Named eras with FIXED calculator spans only — never a bare place-name. */
export type EraId = "wwi" | "wwii" | "korea" | "vietnam";

export type SeasonId = "spring" | "summer" | "fall" | "winter";

export type AnchorKind = LifeEventKind;

export type TemporalRefType =
  | "stated_full_date"
  | "stated_month_year"
  | "stated_year"
  | "stated_decade"
  | "holiday_in_year"
  | "holiday_at_age"
  | "month_at_age"
  | "age"
  | "grade"
  | "life_stage"
  | "years_from_anchor"
  | "named_era"
  | "season_in_year"
  | "season_at_age";

export interface TemporalRef {
  type: TemporalRefType;
  // calendar slots
  year?: number;
  month?: number; // 1–12
  day?: number; // 1–31
  decadeStartYear?: number; // 1950 for "the 1950s"
  // relative slots
  age?: number; // 0–110
  grade?: number; // 1–12
  holiday?: HolidayId;
  lifeStage?: LifeStageId;
  era?: EraId;
  season?: SeasonId;
  anchorKind?: AnchorKind;
  offsetYears?: number; // +10 / -3 for years_from_anchor
  hedge?: boolean; // about / around / I think → never an exact date
  /**
   * Optional debug hint ONLY — the model's own guess at the occurrence. IGNORED for persistence:
   * the calculator is the source of truth. Kept in the type so a parser may carry it for logging.
   */
  hintedOccurrence?: {
    kind: OccurredKind;
    date: string;
    endDate?: string | null;
  };
}

export interface TemporalProposal {
  dateStatus: "resolved" | "unresolvable" | "ambiguous";
  confidence: "high" | "medium" | "low";
  ref?: TemporalRef;
}

export interface ResolveTemporalRefInput {
  ref: TemporalRef;
  birthDate?: string | null;
  lifeEvents?: LifeEventAnchor[];
}

// ---------------------------------------------------------------------------
// Small date math (hand-rolled; no Date/timezone conversion may shift a day)
// ---------------------------------------------------------------------------

interface Ymd {
  y: number;
  m: number;
  d: number;
}

function parseIso(iso: string | null | undefined): Ymd | null {
  if (typeof iso !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const p = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  return isRealCalendarDate(p.y, p.m, p.d) ? p : null;
}

function iso(p: Ymd): string {
  return toIsoDate(p.y, p.m, p.d);
}

/** Add whole years, clamping Feb 29 onto Feb 28 in non-leap target years. */
function addYears(p: Ymd, years: number): Ymd {
  const y = p.y + years;
  const d = p.m === 2 && p.d === 29 && !isRealCalendarDate(y, 2, 29) ? 28 : p.d;
  return { y, m: p.m, d };
}

function dayBefore(p: Ymd): Ymd {
  const ms = Date.UTC(p.y, p.m - 1, p.d) - 86_400_000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The 4th Thursday of November (US Thanksgiving). */
function thanksgivingDay(y: number): number {
  const dow = new Date(Date.UTC(y, 10, 1)).getUTCDay(); // day of week of Nov 1
  return 1 + ((4 - dow + 7) % 7) + 21; // Thursday = 4
}

// ---------------------------------------------------------------------------
// Vocabulary shared by Tier A parse and life-event capture
// ---------------------------------------------------------------------------

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_RE = String.raw`(january|jan\.?|february|feb\.?|march|mar\.?|april|apr\.?|may|june|jun\.?|july|jul\.?|august|aug\.?|september|sept?\.?|october|oct\.?|november|nov\.?|december|dec\.?)`;

function monthIndex(token: string): number | null {
  const key = token.toLowerCase().replace(/\.$/, "").slice(0, 3);
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key);
  return idx === -1 ? null : idx + 1;
}

// ---------------------------------------------------------------------------
// Allowlist tables for the Tier B calculator
// ---------------------------------------------------------------------------

/** Fixed-date holidays plus Thanksgiving (computed). `name` slots into provenance phrasing. */
const HOLIDAY_TABLE: Record<HolidayId, { name: string; md: [number, number] | "thanksgiving" }> = {
  christmas_eve: { name: "Christmas Eve", md: [12, 24] },
  christmas: { name: "Christmas", md: [12, 25] },
  new_years_eve: { name: "New Year's Eve", md: [12, 31] },
  new_years_day: { name: "New Year's Day", md: [1, 1] },
  halloween: { name: "Halloween", md: [10, 31] },
  valentines_day: { name: "Valentine's Day", md: [2, 14] },
  fourth_of_july: { name: "the Fourth of July", md: [7, 4] },
  thanksgiving: { name: "Thanksgiving", md: "thanksgiving" },
};

/** Named eras as period spans (fixed; calculator-owned). */
const ERA_TABLE: Record<EraId, { name: string; start: Ymd; end: Ymd; label: string }> = {
  wwi: { name: "World War I", start: { y: 1914, m: 7, d: 28 }, end: { y: 1918, m: 11, d: 11 }, label: "1914–1918" },
  wwii: { name: "World War II", start: { y: 1939, m: 9, d: 1 }, end: { y: 1945, m: 9, d: 2 }, label: "1939–1945" },
  korea: { name: "the Korean War", start: { y: 1950, m: 6, d: 25 }, end: { y: 1953, m: 7, d: 27 }, label: "1950–1953" },
  vietnam: { name: "the Vietnam War", start: { y: 1955, m: 11, d: 1 }, end: { y: 1975, m: 4, d: 30 }, label: "1955–1975" },
};

/** Life-stage spans as age offsets from birthdate (calculator policy). */
const LIFE_STAGE_TABLE: Record<LifeStageId, { startAge: [number, number]; endAge: [number, number]; name: string }> = {
  // [ageOffset, monthOfYear] — start on the birthday-year Sep, end on the exit Jun, per school calendar.
  elementary_school: { startAge: [5, 9], endAge: [11, 6], name: "elementary school" },
  middle_school: { startAge: [11, 9], endAge: [14, 6], name: "middle school" },
  high_school: { startAge: [14, 9], endAge: [18, 6], name: "high school" },
  college: { startAge: [18, 9], endAge: [22, 6], name: "college" },
};

/** Meteorological season bounds (calculator policy): spring Mar–May, summer Jun–Aug, etc. */
const SEASON_TABLE: Record<SeasonId, { startMonth: number; endMonth: number; name: string; crossesYear?: boolean }> = {
  spring: { startMonth: 3, endMonth: 5, name: "spring" },
  summer: { startMonth: 6, endMonth: 8, name: "summer" },
  fall: { startMonth: 9, endMonth: 11, name: "fall" },
  // Winter (Dec–Feb) crosses the year boundary; the calculator anchors it to Dec of the stated year.
  winter: { startMonth: 12, endMonth: 2, name: "winter", crossesYear: true },
};

const ANCHOR_LABEL: Record<LifeEventKind, string> = {
  wedding: "wedding",
  graduation: "graduation",
  military_service: "military service",
  move: "move",
  other: "other",
};

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ===========================================================================
// Tier A — stated calendar only (deterministic, no LLM, no guessing)
// ===========================================================================

interface Candidate {
  /** 3 = date, 2 = period, 1 = circa — the ADR-0026 precedence date > period > circa. */
  rank: 1 | 2 | 3;
  pos: number;
  occurrence: StoryDateOccurrence;
}

interface Mention {
  pos: number;
  end: number;
}

function overlaps(m: Mention, spans: Mention[]): boolean {
  return spans.some((s) => m.pos < s.end && s.pos < m.end);
}

/**
 * Tier A: resolve ONLY the stated calendar the narrator's words assert directly. Full dates,
 * month+year, bare year, and explicit four-digit decades. NO relative/age/holiday/anchor/era math,
 * NO place-names, NO century guessing. Anything else → unresolvable (Tier B / the temporal ask).
 */
export function resolveStatedStoryDate(input: ResolveStoryDateInput): StoryDateResolution {
  try {
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim().length === 0) return UNRESOLVABLE;

    const candidates: Candidate[] = [];
    const fullDateSpans: Mention[] = [];

    // --- Stated full dates: "December 25, 1943", "25 December 1943" → date ---
    const usDate = new RegExp(String.raw`\b${MONTH_RE}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:1[89]|20)\d{2})\b`, "gi");
    const dayFirst = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH_RE},?\s+((?:1[89]|20)\d{2})\b`, "gi");
    for (const m of text.matchAll(usDate)) {
      pushFullDate(candidates, fullDateSpans, m.index, m[2]!, m[1]!, m[3]!, m[0]);
    }
    for (const m of text.matchAll(dayFirst)) {
      pushFullDate(candidates, fullDateSpans, m.index, m[1]!, m[2]!, m[3]!, m[0]);
    }

    // --- Stated month + year: "December 1943" → period aligned to the month ---
    const monthYearSpans: Mention[] = [];
    const monthYearRe = new RegExp(String.raw`\b${MONTH_RE}\s+((?:1[89]|20)\d{2})\b`, "gi");
    for (const m of text.matchAll(monthYearRe)) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (overlaps(mention, fullDateSpans)) continue;
      const month = monthIndex(m[1]!);
      const year = Number(m[2]);
      if (month === null) continue;
      monthYearSpans.push(mention);
      candidates.push({
        rank: 2, pos: m.index,
        occurrence: {
          kind: "period",
          date: toIsoDate(year, month, 1),
          endDate: toIsoDate(year, month, lastDayOfMonth(year, month)),
          provenance: `stated "${MONTH_LONG[month - 1]} ${year}"`,
        },
      });
    }

    // --- Explicit four-digit decade: "the 1950s" / "1950s" → period decade ---
    // ONLY a full four-digit decade is a stated calendar form. A bare "the 50s" is a century guess
    // and is DELETED (Tier B / unresolved) — its ambiguity is a known Timeline-poisoning bug.
    const decadeSpans: Mention[] = [];
    for (const m of text.matchAll(/\b(?:the\s+)?'?((?:1[89]|20)\d)0s\b/gi)) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (overlaps(mention, fullDateSpans) || overlaps(mention, monthYearSpans)) continue;
      const start = Number(m[1]) * 10;
      decadeSpans.push(mention);
      candidates.push({
        rank: 2, pos: m.index,
        occurrence: {
          kind: "period",
          date: toIsoDate(start, 1, 1),
          endDate: toIsoDate(start + 9, 12, 31),
          provenance: `stated "the ${start}s"`,
        },
      });
    }

    // --- Stated bare year: "in 1958" → period aligned to the year ---
    for (const m of text.matchAll(/\b((?:1[89]|20)\d{2})\b/g)) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (
        overlaps(mention, fullDateSpans) ||
        overlaps(mention, monthYearSpans) ||
        overlaps(mention, decadeSpans)
      ) {
        continue;
      }
      const year = Number(m[1]);
      candidates.push({
        rank: 2, pos: mention.pos,
        occurrence: {
          kind: "period",
          date: toIsoDate(year, 1, 1),
          endDate: toIsoDate(year, 12, 31),
          provenance: `stated year "${year}"`,
        },
      });
    }

    if (candidates.length === 0) return UNRESOLVABLE;
    // Precedence: date > period > circa; earliest mention wins ties.
    candidates.sort((a, b) => b.rank - a.rank || a.pos - b.pos);
    return { status: "resolved", occurrence: candidates[0]!.occurrence };
  } catch {
    return UNRESOLVABLE;
  }
}

function pushFullDate(
  candidates: Candidate[],
  spans: Mention[],
  pos: number,
  dayToken: string,
  monthToken: string,
  yearToken: string,
  matched: string,
): void {
  const month = monthIndex(monthToken);
  const day = Number(dayToken);
  const year = Number(yearToken);
  if (month === null || !isRealCalendarDate(year, month, day)) return;
  spans.push({ pos, end: pos + matched.length });
  candidates.push({
    rank: 3, pos,
    occurrence: {
      kind: "date", date: toIsoDate(year, month, day), endDate: null,
      provenance: `stated date "${MONTH_LONG[month - 1]} ${day}, ${year}"`,
    },
  });
}

// ===========================================================================
// Tier B — pure calculator over a validated structured ref (ADR-0026 §4.3)
// ===========================================================================

/**
 * Resolve a validated `TemporalRef` into an occurrence. Pure; never throws; returns unresolvable
 * on a missing/invalid anchor or an invalid calendar rather than inventing a date. The calculator
 * — not the model — owns every calendar computation and the resulting form:
 *   - `kind: "date"` only for day-level refs (stated_full_date, holiday_in_year, holiday_at_age);
 *   - `age` / `grade` / `life_stage` / `season` / `named_era` → period/circa, never a fake day;
 *   - `ref.hedge` downgrades an otherwise-exact form away from `date`.
 * A model-emitted `hintedOccurrence` is IGNORED — this function is the source of truth.
 */
export function resolveTemporalRef(input: ResolveTemporalRefInput): StoryDateResolution {
  try {
    const ref = input?.ref;
    if (!ref || typeof ref !== "object" || typeof ref.type !== "string") return UNRESOLVABLE;
    const birth = parseIso(input.birthDate);
    const lifeEvents = Array.isArray(input.lifeEvents) ? input.lifeEvents : [];

    switch (ref.type) {
      case "stated_full_date": {
        if (!isYear(ref.year) || !isMonth(ref.month) || !isDay(ref.day)) return UNRESOLVABLE;
        if (!isRealCalendarDate(ref.year!, ref.month!, ref.day!)) return UNRESOLVABLE;
        return ok("date", toIsoDate(ref.year!, ref.month!, ref.day!), null,
          `stated date "${MONTH_LONG[ref.month! - 1]} ${ref.day}, ${ref.year}"`);
      }
      case "stated_month_year": {
        if (!isYear(ref.year) || !isMonth(ref.month)) return UNRESOLVABLE;
        return ok("period", toIsoDate(ref.year!, ref.month!, 1),
          toIsoDate(ref.year!, ref.month!, lastDayOfMonth(ref.year!, ref.month!)),
          `stated "${MONTH_LONG[ref.month! - 1]} ${ref.year}"`);
      }
      case "stated_year": {
        if (!isYear(ref.year)) return UNRESOLVABLE;
        return ok("period", toIsoDate(ref.year!, 1, 1), toIsoDate(ref.year!, 12, 31),
          `stated year "${ref.year}"`);
      }
      case "stated_decade": {
        const start = ref.decadeStartYear;
        if (typeof start !== "number" || start % 10 !== 0 || start < 1800 || start > 2100) return UNRESOLVABLE;
        return ok("period", toIsoDate(start, 1, 1), toIsoDate(start + 9, 12, 31), `stated "the ${start}s"`);
      }
      case "holiday_in_year": {
        if (!isYear(ref.year) || !ref.holiday || !(ref.holiday in HOLIDAY_TABLE)) return UNRESOLVABLE;
        const h = HOLIDAY_TABLE[ref.holiday];
        const md = h.md === "thanksgiving" ? [11, thanksgivingDay(ref.year!)] as [number, number] : h.md;
        if (!isRealCalendarDate(ref.year!, md[0], md[1])) return UNRESOLVABLE;
        const kind = ref.hedge ? "circa" : "date";
        return ok(kind, toIsoDate(ref.year!, md[0], md[1]), null, `stated "${h.name} ${ref.year}"`);
      }
      case "holiday_at_age": {
        if (!birth || !isAge(ref.age) || !ref.holiday || !(ref.holiday in HOLIDAY_TABLE)) return UNRESOLVABLE;
        const h = HOLIDAY_TABLE[ref.holiday];
        const point = holidayInAgeYear(birth, ref.age!, h.md);
        if (!point) return UNRESOLVABLE;
        const kind = ref.hedge ? "circa" : "date";
        return ok(kind, iso(point), null, `age ${ref.age} at ${h.name}, from birthdate`);
      }
      case "month_at_age": {
        if (!birth || !isAge(ref.age) || !isMonth(ref.month)) return UNRESOLVABLE;
        // The calendar year in which the narrator is `age` during that month.
        const beforeBirthday = ref.month! < birth.m || (ref.month! === birth.m && 1 < birth.d);
        const y = birth.y + ref.age! + (beforeBirthday ? 1 : 0);
        return ok("period", toIsoDate(y, ref.month!, 1), toIsoDate(y, ref.month!, lastDayOfMonth(y, ref.month!)),
          `${MONTH_LONG[ref.month! - 1]} at age ${ref.age}, from birthdate`);
      }
      case "age": {
        if (!birth || !isAge(ref.age)) return UNRESOLVABLE;
        const start = addYears(birth, ref.age!);
        if (ref.hedge) {
          return ok("circa", iso(start), null, `around age ${ref.age}, from birthdate`);
        }
        const end = dayBefore(addYears(birth, ref.age! + 1));
        return ok("period", iso(start), iso(end), `age ${ref.age}, from birthdate`);
      }
      case "grade": {
        if (!birth || typeof ref.grade !== "number" || ref.grade < 1 || ref.grade > 12) return UNRESOLVABLE;
        return ok("circa", iso(addYears(birth, ref.grade + 6)), null,
          `${ordinalSuffix(ref.grade)} grade (age ${ref.grade + 5}–${ref.grade + 6}), from birthdate`);
      }
      case "life_stage": {
        if (!birth || !ref.lifeStage || !(ref.lifeStage in LIFE_STAGE_TABLE)) return UNRESOLVABLE;
        const s = LIFE_STAGE_TABLE[ref.lifeStage];
        return ok("period",
          toIsoDate(birth.y + s.startAge[0], s.startAge[1], 1),
          toIsoDate(birth.y + s.endAge[0], s.endAge[1], lastDayOfMonth(birth.y + s.endAge[0], s.endAge[1])),
          `${s.name} years, from birthdate`);
      }
      case "years_from_anchor": {
        if (!ref.anchorKind || typeof ref.offsetYears !== "number") return UNRESOLVABLE;
        if (ref.offsetYears < -100 || ref.offsetYears > 100) return UNRESOLVABLE;
        // First matching anchor of the kind. Disambiguating multiple same-kind anchors (e.g. two
        // weddings) is deferred past v1 by the spec; a single anchor is the common case.
        const anchor = lifeEvents.find((e) => e && e.kind === ref.anchorKind);
        const anchorDate = anchor ? parseIso(anchor.date) : null;
        if (!anchorDate) return UNRESOLVABLE;
        const point = addYears(anchorDate, ref.offsetYears);
        const dir = ref.offsetYears >= 0 ? "after" : "before";
        return ok("circa", iso(point), null,
          `${Math.abs(ref.offsetYears)} years ${dir} the ${ANCHOR_LABEL[ref.anchorKind]}, from that life event`);
      }
      case "named_era": {
        if (!ref.era || !(ref.era in ERA_TABLE)) return UNRESOLVABLE;
        const e = ERA_TABLE[ref.era];
        return ok("period", iso(e.start), iso(e.end), `${e.name}, taken as ${e.label}`);
      }
      case "season_in_year": {
        if (!isYear(ref.year) || !ref.season || !(ref.season in SEASON_TABLE)) return UNRESOLVABLE;
        return seasonPeriod(ref.season, ref.year!, `stated "${SEASON_TABLE[ref.season].name} ${ref.year}"`);
      }
      case "season_at_age": {
        if (!birth || !isAge(ref.age) || !ref.season || !(ref.season in SEASON_TABLE)) return UNRESOLVABLE;
        const s = SEASON_TABLE[ref.season];
        // The calendar year in which the narrator is `age` during that season's start month.
        const beforeBirthday = s.startMonth < birth.m;
        const y = birth.y + ref.age! + (beforeBirthday ? 1 : 0);
        return seasonPeriod(ref.season, y, `${s.name} at age ${ref.age}, from birthdate`);
      }
      default:
        return UNRESOLVABLE;
    }
  } catch {
    return UNRESOLVABLE;
  }
}

function ok(kind: OccurredKind, date: string, endDate: string | null, provenance: string): StoryDateResolution {
  return { status: "resolved", occurrence: { kind, date, endDate, provenance } };
}

function isYear(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1800 && n <= 2200;
}
function isMonth(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 12;
}
function isDay(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31;
}
function isAge(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 110;
}

function seasonPeriod(season: SeasonId, year: number, provenance: string): StoryDateResolution {
  const s = SEASON_TABLE[season];
  if (s.crossesYear) {
    // Winter: Dec of `year` → end of Feb of `year + 1`.
    return ok("period", toIsoDate(year, 12, 1), toIsoDate(year + 1, 2, lastDayOfMonth(year + 1, 2)), provenance);
  }
  return ok("period", toIsoDate(year, s.startMonth, 1),
    toIsoDate(year, s.endMonth, lastDayOfMonth(year, s.endMonth)), provenance);
}

/** The holiday date on which the narrator (born `birth`) was exactly `age` years old. */
function holidayInAgeYear(birth: Ymd, age: number, md: [number, number] | "thanksgiving"): Ymd | null {
  if (md === "thanksgiving") {
    // Thanksgiving moves (Nov 22–28), so its day depends on the very year we are choosing. Compute
    // the day for the provisional age-year FIRST, then decide whether the narrator's birthday has
    // already passed by then — a hard-coded Nov 22 probe mis-picks the year for a late-November
    // birthday (born Nov 23–28).
    let y = birth.y + age;
    let day = thanksgivingDay(y);
    const thanksgivingBeforeBirthday = 11 < birth.m || (11 === birth.m && day < birth.d);
    if (thanksgivingBeforeBirthday) {
      y = birth.y + age + 1;
      day = thanksgivingDay(y);
    }
    return isRealCalendarDate(y, 11, day) ? { y, m: 11, d: day } : null;
  }
  const [hm, hd] = md;
  const beforeBirthday = hm < birth.m || (hm === birth.m && hd < birth.d);
  const y = birth.y + age + (beforeBirthday ? 1 : 0);
  return isRealCalendarDate(y, hm, hd) ? { y, m: hm, d: hd } : null;
}

// ===========================================================================
// Defensive parser — LLM JSON → validated TemporalProposal (ADR-0026 §4.3)
// ===========================================================================

const REF_TYPES: ReadonlySet<string> = new Set<TemporalRefType>([
  "stated_full_date", "stated_month_year", "stated_year", "stated_decade",
  "holiday_in_year", "holiday_at_age", "month_at_age", "age", "grade",
  "life_stage", "years_from_anchor", "named_era", "season_in_year", "season_at_age",
]);
const HOLIDAY_IDS: ReadonlySet<string> = new Set(Object.keys(HOLIDAY_TABLE));
const LIFE_STAGE_IDS: ReadonlySet<string> = new Set(Object.keys(LIFE_STAGE_TABLE));
const ERA_IDS: ReadonlySet<string> = new Set(Object.keys(ERA_TABLE));
const SEASON_IDS: ReadonlySet<string> = new Set(Object.keys(SEASON_TABLE));
const ANCHOR_KINDS: ReadonlySet<string> = new Set<AnchorKind>([
  "wedding", "graduation", "military_service", "move", "other",
]);

/**
 * Parse a model reply into a `TemporalProposal`. Tolerant of fenced/raw JSON. Unknown `type`,
 * unknown allowlist value, or malformed shape → `{ dateStatus: "unresolvable" }` (never invent a
 * type at runtime). Numeric slots are coerced only from real numbers, never from arbitrary strings.
 */
export function parseTemporalProposal(text: string): TemporalProposal {
  const unresolved: TemporalProposal = { dateStatus: "unresolvable", confidence: "low" };
  const jsonStr = String(text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return unresolved;
  }
  if (typeof parsed !== "object" || parsed === null) return unresolved;
  const o = parsed as Record<string, unknown>;

  const dateStatus =
    o.dateStatus === "resolved" || o.dateStatus === "ambiguous" ? o.dateStatus : "unresolvable";
  const confidence =
    o.confidence === "high" || o.confidence === "medium" ? o.confidence : "low";

  const rawRef = o.ref;
  if (dateStatus !== "resolved" || typeof rawRef !== "object" || rawRef === null) {
    return { dateStatus: dateStatus === "ambiguous" ? "ambiguous" : "unresolvable", confidence };
  }
  const r = rawRef as Record<string, unknown>;
  if (typeof r.type !== "string" || !REF_TYPES.has(r.type)) return { dateStatus: "unresolvable", confidence };

  const ref: TemporalRef = { type: r.type as TemporalRefType };
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  if (num(r.year) !== undefined) ref.year = num(r.year);
  if (num(r.month) !== undefined) ref.month = num(r.month);
  if (num(r.day) !== undefined) ref.day = num(r.day);
  if (num(r.decadeStartYear) !== undefined) ref.decadeStartYear = num(r.decadeStartYear);
  if (num(r.age) !== undefined) ref.age = num(r.age);
  if (num(r.grade) !== undefined) ref.grade = num(r.grade);
  if (num(r.offsetYears) !== undefined) ref.offsetYears = num(r.offsetYears);
  if (typeof r.holiday === "string" && HOLIDAY_IDS.has(r.holiday)) ref.holiday = r.holiday as HolidayId;
  if (typeof r.lifeStage === "string" && LIFE_STAGE_IDS.has(r.lifeStage)) ref.lifeStage = r.lifeStage as LifeStageId;
  if (typeof r.era === "string" && ERA_IDS.has(r.era)) ref.era = r.era as EraId;
  if (typeof r.season === "string" && SEASON_IDS.has(r.season)) ref.season = r.season as SeasonId;
  if (typeof r.anchorKind === "string" && ANCHOR_KINDS.has(r.anchorKind)) ref.anchorKind = r.anchorKind as AnchorKind;
  if (r.hedge === true) ref.hedge = true;

  return { dateStatus: "resolved", confidence, ref };
}

// ===========================================================================
// Stated life-event capture (issue #245, ADR-0026)
// ===========================================================================

/**
 * A life-event fact stated in a telling ("we married in '58", "after I graduated in '61") — the
 * reusable anchor, pared to kind + occurrence, ready to persist on the narrator.
 */
export interface StatedLifeEvent {
  kind: LifeEventKind;
  occurrence: StoryDateOccurrence;
}

export interface ExtractStatedLifeEventsInput {
  /** The telling (one utterance) — transcript or prose. */
  text: string;
  /** The narrator's birth date (ISO YYYY-MM-DD) — settles the century of a 2-digit "'58". */
  birthDate?: string | null;
}

/**
 * Anchor words strong enough to carry a silent write. Deliberately narrow: bare "military" /
 * "service" are dropped (a church service is not military service). A wrong life event silently
 * corrupts later derivations, so this errs toward UNDER-capture (ADR-0026 §4.6).
 */
const STATED_EVENT_WORDS: Record<string, LifeEventKind> = {
  married: "wedding", wed: "wedding", wedding: "wedding",
  graduated: "graduation", graduation: "graduation",
  moved: "move", move: "move",
  enlisted: "military_service", army: "military_service",
  navy: "military_service", marines: "military_service",
};

/** How far from the anchor word (chars, either side) a date expression may sit and still belong to it. */
const EVENT_WINDOW = 48;

const NUM_RELATIVE = String.raw`(?:\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|one|two|three|four|five|six|seven|eight|nine)`;

/**
 * The anchor-relative guard: "ten years after we married" USES the event as a reference — it
 * states nothing about when the wedding was, so it must not record one.
 */
const RELATIVE_REFERENCE_GUARD = new RegExp(
  String.raw`(?:about\s+|around\s+|roughly\s+)?${NUM_RELATIVE}\s+years?\s+(?:after|before)\s+(?:(?:we|i|the|our|my)\s+)*$`,
  "i",
);

/** Sentence boundaries sever the anchor↔date pairing ("We married young. In 1968…" pairs nothing). */
const CLAUSE_BOUNDARY = /[.!?\n]/;

/**
 * Extract the life-event facts STATED in a telling. Never throws; anything unclear yields no
 * event. Only STATED calendar forms pair with an anchor (full date > month+year > bare year), and
 * only within the same clause; relative references record nothing. A 2-digit year ("'58") takes
 * the 1900s unless the narrator wasn't alive for it (birth year > 1959).
 */
export function extractStatedLifeEvents(input: ExtractStatedLifeEventsInput): StatedLifeEvent[] {
  try {
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim().length === 0) return [];
    const birth = parseIso(input?.birthDate);

    interface DateExpr {
      pos: number;
      end: number;
      /** 3 = full date, 2 = month+year, 1 = bare year — most precise wins an anchor. */
      rank: 1 | 2 | 3;
      date: string;
      endDate: string | null;
    }

    const dates: DateExpr[] = [];
    const fullSpans: Mention[] = [];
    const collectFull = (re: RegExp, dayGroup: number, monthGroup: number, yearGroup: number) => {
      for (const m of text.matchAll(re)) {
        const month = monthIndex(m[monthGroup]!);
        const day = Number(m[dayGroup]!);
        const year = Number(m[yearGroup]!);
        if (month === null || !isRealCalendarDate(year, month, day)) continue;
        fullSpans.push({ pos: m.index, end: m.index + m[0].length });
        dates.push({ pos: m.index, end: m.index + m[0].length, rank: 3, date: toIsoDate(year, month, day), endDate: null });
      }
    };
    collectFull(new RegExp(String.raw`\b${MONTH_RE}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:1[89]|20)\d{2})\b`, "gi"), 2, 1, 3);
    collectFull(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH_RE},?\s+((?:1[89]|20)\d{2})\b`, "gi"), 1, 2, 3);

    const monthYearSpans: Mention[] = [];
    for (const m of text.matchAll(new RegExp(String.raw`\b${MONTH_RE}\s+((?:1[89]|20)\d{2})\b`, "gi"))) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (overlaps(mention, fullSpans)) continue;
      const month = monthIndex(m[1]!);
      if (month === null) continue;
      const year = Number(m[2]);
      monthYearSpans.push(mention);
      dates.push({
        pos: mention.pos, end: mention.end, rank: 2,
        date: toIsoDate(year, month, 1),
        endDate: toIsoDate(year, month, lastDayOfMonth(year, month)),
      });
    }

    for (const m of text.matchAll(/\b((?:1[89]|20)\d{2})\b/g)) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (overlaps(mention, fullSpans) || overlaps(mention, monthYearSpans)) continue;
      const year = Number(m[1]);
      dates.push({ pos: mention.pos, end: mention.end, rank: 1, date: toIsoDate(year, 1, 1), endDate: toIsoDate(year, 12, 31) });
    }
    for (const m of text.matchAll(/'(\d{2})\b/g)) {
      const mention = { pos: m.index, end: m.index + m[0].length };
      if (overlaps(mention, fullSpans) || overlaps(mention, monthYearSpans)) continue;
      const short = Number(m[1]);
      const year = birth !== null && birth.y > 1959 ? 2000 + short : 1900 + short;
      // A life event cannot predate the narrator's birth. This clockless guard drops the
      // impossible century read of an ambiguous 2-digit year ("'85" for someone born 1990) rather
      // than capturing a wrong anchor — under-capture over a silent corruption (ADR-0026 §4.6).
      if (birth !== null && year < birth.y) continue;
      dates.push({ pos: mention.pos, end: mention.end, rank: 1, date: toIsoDate(year, 1, 1), endDate: toIsoDate(year, 12, 31) });
    }

    const events: StatedLifeEvent[] = [];
    const seen = new Set<string>();
    const anchorRe = /\b(married|wed|wedding|graduated|graduation|moved|move|enlisted|army|navy|marines)\b/gi;
    for (const m of text.matchAll(anchorRe)) {
      const kind = STATED_EVENT_WORDS[m[1]!.toLowerCase()]!;
      const anchorEnd = m.index + m[0].length;
      if (RELATIVE_REFERENCE_GUARD.test(text.slice(Math.max(0, m.index - EVENT_WINDOW), m.index))) continue;

      let best: (DateExpr & { gap: number }) | null = null;
      for (const d of dates) {
        if (d.pos < m.index - EVENT_WINDOW || d.pos > anchorEnd + EVENT_WINDOW) continue;
        const before = d.end <= m.index;
        const gap = before ? m.index - d.end : d.pos - anchorEnd;
        if (gap < 0) continue;
        if (CLAUSE_BOUNDARY.test(before ? text.slice(d.end, m.index) : text.slice(anchorEnd, d.pos))) continue;
        if (best === null || d.rank > best.rank || (d.rank === best.rank && gap < best.gap)) {
          best = { ...d, gap };
        }
      }
      if (best === null) continue;

      const occurrence: StoryDateOccurrence = {
        kind: best.rank === 3 ? "date" : "period",
        date: best.date,
        endDate: best.rank === 3 ? null : best.endDate,
        provenance: `stated "${text.slice(Math.min(m.index, best.pos), Math.max(anchorEnd, best.end))}" in a telling`,
      };
      const key = `${kind}:${occurrence.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ kind, occurrence });
    }
    return events;
  } catch {
    return [];
  }
}
