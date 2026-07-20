/**
 * Story date resolver (ADR-0026) — the shared brain that turns a telling's own words into one of
 * the three Story date forms. Takes (story text, narrator birthdate, known life events) and
 * returns either a resolved occurrence — kind, date, end date, and a plain-language provenance
 * note — or "unresolvable". It handles stated dates ("December 25, 1943", "1958",
 * "December 1943", "the 50s"), age references ("when I was 8"), grade references ("in 8th
 * grade" → circa, birth+13/14), holiday references ("for Christmas" → Dec 25 of the resolved
 * year), anchor-relative references ("about ten years after we married" → circa against the
 * wedding life event), and period language ("when I was in high school", "during the war").
 *
 * The discipline is the parse-spoken-date tradition: tolerant and NEVER throws — anything it
 * cannot derive comes back as `unresolvable`, never an exception and never an invented date.
 * When several forms are derivable it captures the most precise the storyteller's own words
 * support: date > period > circa. It never invents precision the telling doesn't contain — a
 * bare year is a year-long period, not a point; "about" language is circa, not a date.
 *
 * Pure: no DB, no LLM, no clock. Every resolved value carries a provenance note naming the
 * derivation (e.g. "age 8 at Christmas, from birthdate") because the note is user-visible — a
 * wrong inference is a displayed, correctable fact, not a hidden one.
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
// Word numbers ("eight", "twenty-one") and ordinals ("eighth")
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
};

function wordNumber(token: string): number | null {
  const w = token.toLowerCase().replace(/-/g, " ").trim();
  if (UNITS[w] !== undefined) return UNITS[w]!;
  if (TEENS[w] !== undefined) return TEENS[w]!;
  if (TENS[w] !== undefined) return TENS[w]!;
  const parts = w.split(/\s+/);
  if (parts.length === 2 && TENS[parts[0]!] !== undefined && UNITS[parts[1]!] !== undefined) {
    return TENS[parts[0]!]! + UNITS[parts[1]!]!;
  }
  return null;
}

/** A number token: digits, a unit/teen word, or a tens word with an optional unit ("twenty one"). */
const NUM = String.raw`(?:\d{1,3}|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|one|two|three|four|five|six|seven|eight|nine)`;

function toNumber(token: string): number | null {
  const t = token.trim();
  if (/^\d+$/.test(t)) return Number(t);
  return wordNumber(t);
}

function ordinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ---------------------------------------------------------------------------
// Vocabulary
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

/** Fixed-date holidays plus Thanksgiving (computed). `name` slots into provenance phrasing. */
const HOLIDAYS: Array<{ key: RegExp; name: string; md: [number, number] | "thanksgiving" }> = [
  { key: /\bchristmas\s+eve\b/i, name: "Christmas Eve", md: [12, 24] },
  { key: /\bchristmas\b/i, name: "Christmas", md: [12, 25] },
  { key: /\bhalloween\b/i, name: "Halloween", md: [10, 31] },
  { key: /\bvalentine'?s\s+day\b/i, name: "Valentine's Day", md: [2, 14] },
  { key: /\b(?:fourth\s+of\s+july|4th\s+of\s+july|july\s+(?:4|4th|fourth)|independence\s+day)\b/i, name: "the Fourth of July", md: [7, 4] },
  { key: /\bnew\s+year'?s\s+day\b/i, name: "New Year's Day", md: [1, 1] },
  { key: /\bnew\s+year'?s\s+eve\b/i, name: "New Year's Eve", md: [12, 31] },
  { key: /\bthanksgiving\b/i, name: "Thanksgiving", md: "thanksgiving" },
];

/** Named wars as period spans. Bare "the war" resolves to WWII when the narrator was alive for it. */
const WARS = {
  wwi: { name: "World War I", start: { y: 1914, m: 7, d: 28 }, end: { y: 1918, m: 11, d: 11 }, label: "1914–1918" },
  wwii: { name: "World War II", start: { y: 1939, m: 9, d: 1 }, end: { y: 1945, m: 9, d: 2 }, label: "1939–1945" },
  korea: { name: "the Korean War", start: { y: 1950, m: 6, d: 25 }, end: { y: 1953, m: 7, d: 27 }, label: "1950–1953" },
  vietnam: { name: "the Vietnam War", start: { y: 1955, m: 11, d: 1 }, end: { y: 1975, m: 4, d: 30 }, label: "1955–1975" },
} as const;

const DECADE_WORDS: Record<string, number> = {
  twenties: 20, thirties: 30, forties: 40, fifties: 50, sixties: 60,
  seventies: 70, eighties: 80, nineties: 90,
};

const ANCHOR_WORDS: Record<string, LifeEventKind> = {
  married: "wedding", wed: "wedding", wedding: "wedding",
  graduated: "graduation", graduation: "graduation",
  moved: "move", move: "move",
  enlisted: "military_service", army: "military_service", navy: "military_service",
  marines: "military_service", military: "military_service", service: "military_service",
};

const ANCHOR_LABEL: Record<LifeEventKind, string> = {
  wedding: "wedding",
  graduation: "graduation",
  military_service: "military service",
  move: "move",
  other: "other",
};

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface Candidate {
  /** 3 = date, 2 = period, 1 = circa — the ADR-0026 precedence date > period > circa. */
  rank: 1 | 2 | 3;
  /** True when the teller's words state the form directly (tie-breaks above derived forms). */
  stated: boolean;
  /** Match position in the text (final tie-break: earliest mention wins). */
  pos: number;
  occurrence: StoryDateOccurrence;
}

interface Mention {
  pos: number;
  end: number;
  text: string;
}

function overlaps(m: Mention, spans: Mention[]): boolean {
  return spans.some((s) => m.pos < s.end && s.pos < m.end);
}

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the Story date from a telling. Never throws; anything underivable returns
 * `{ status: "unresolvable" }`. Precedence when several forms are derivable:
 * date > period > circa (ADR-0026).
 */
export function resolveStoryDate(input: ResolveStoryDateInput): StoryDateResolution {
  try {
    const text = typeof input?.text === "string" ? input.text : "";
    if (text.trim().length === 0) return UNRESOLVABLE;
    const birth = parseIso(input.birthDate);
    const lifeEvents = Array.isArray(input.lifeEvents) ? input.lifeEvents : [];

    const candidates: Candidate[] = [];

    // --- Stated full dates: "December 25, 1943", "December 25th 1943", "25 December 1943" ---
    const fullDateSpans: Mention[] = [];
    const usDate = new RegExp(String.raw`\b${MONTH_RE}\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:1[89]|20)\d{2})\b`, "gi");
    const dayFirst = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH_RE},?\s+((?:1[89]|20)\d{2})\b`, "gi");
    for (const m of text.matchAll(usDate)) {
      pushFullDate(candidates, fullDateSpans, m.index, m[2]!, m[1]!, m[3]!, m[0]);
    }
    for (const m of text.matchAll(dayFirst)) {
      pushFullDate(candidates, fullDateSpans, m.index, m[1]!, m[2]!, m[3]!, m[0]);
    }

    // --- Mentions used by the combination rules below ---
    const holidayMentions: Array<Mention & { name: string; md: [number, number] | "thanksgiving" }> = [];
    for (const h of HOLIDAYS) {
      const re = new RegExp(h.key.source, "gi");
      for (const m of text.matchAll(re)) {
        holidayMentions.push({ pos: m.index, end: m.index + m[0].length, text: m[0], name: h.name, md: h.md });
      }
    }
    const ageRe = new RegExp(String.raw`\b(?:when\s+i\s+was|at\s+age|aged?)\s*(?:about\s+|around\s+)?(${NUM})\b`, "gi");
    const ageMentions: Array<Mention & { age: number }> = [];
    for (const m of text.matchAll(ageRe)) {
      const age = toNumber(m[1]!);
      if (age !== null && age >= 0 && age <= 110) {
        ageMentions.push({ pos: m.index, end: m.index + m[0].length, text: m[0], age });
      }
    }
    const yearRe = /\b((?:1[89]|20)\d{2})\b/g;
    const yearMentions: Array<Mention & { year: number }> = [];
    for (const m of text.matchAll(yearRe)) {
      const mention = { pos: m.index, end: m.index + m[0].length, text: m[0], year: Number(m[1]) };
      if (!overlaps(mention, fullDateSpans)) yearMentions.push(mention);
    }

    // --- Holiday combinations → date. "Christmas when I was 8" (age anchor) or "Christmas of
    //     1958" (stated year). A holiday alone names a month/day; the year must be derivable. ---
    for (const h of holidayMentions) {
      const nearestAge = nearest(h, ageMentions);
      const nearestYear = nearest(h, yearMentions);
      const useAge =
        nearestAge !== null &&
        (nearestYear === null || dist(h, nearestAge) <= dist(h, nearestYear));
      if (useAge && nearestAge && birth) {
        const point = holidayInAgeYear(birth, nearestAge.age, h.md);
        if (point) {
          candidates.push({
            rank: 3, stated: false, pos: h.pos,
            occurrence: {
              kind: "date", date: iso(point), endDate: null,
              provenance: `age ${nearestAge.age} at ${h.name}, from birthdate`,
            },
          });
          continue;
        }
      }
      if (nearestYear) {
        const md = h.md === "thanksgiving" ? [11, thanksgivingDay(nearestYear.year)] as [number, number] : h.md;
        candidates.push({
          rank: 3, stated: true, pos: h.pos,
          occurrence: {
            kind: "date", date: toIsoDate(nearestYear.year, md[0], md[1]), endDate: null,
            provenance: `stated "${h.name} ${nearestYear.year}"`,
          },
        });
      }
    }

    // --- Stated month + year: "December 1943" → period aligned to the month ---
    const monthYearRe = new RegExp(String.raw`\b${MONTH_RE}\s+((?:1[89]|20)\d{2})\b`, "gi");
    for (const m of text.matchAll(monthYearRe)) {
      const mention = { pos: m.index, end: m.index + m[0].length, text: m[0] };
      if (overlaps(mention, fullDateSpans)) continue;
      const month = monthIndex(m[1]!);
      const year = Number(m[2]);
      if (month === null) continue;
      candidates.push({
        rank: 2, stated: true, pos: m.index,
        occurrence: {
          kind: "period",
          date: toIsoDate(year, month, 1),
          endDate: toIsoDate(year, month, lastDayOfMonth(year, month)),
          provenance: `stated "${MONTH_LONG[month - 1]} ${year}"`,
        },
      });
    }

    // --- Stated bare year: "in 1958" → period aligned to the year ---
    for (const y of yearMentions) {
      candidates.push({
        rank: 2, stated: true, pos: y.pos,
        occurrence: {
          kind: "period",
          date: toIsoDate(y.year, 1, 1),
          endDate: toIsoDate(y.year, 12, 31),
          provenance: `stated year "${y.year}"`,
        },
      });
    }

    // --- Decades: "the 50s", "the '50s", "the 1950s", "the fifties" → period decade ---
    const pushDecade = (pos: number, text0: string, short: number | null, explicitStart: number | null) => {
      let start: number;
      if (explicitStart !== null) {
        start = explicitStart;
      } else if (short !== null) {
        // A bare "50s" assumes the 1900s unless the narrator wasn't alive for it.
        start = birth !== null && birth.y > 1959 ? 2000 + short : 1900 + short;
      } else {
        return;
      }
      candidates.push({
        rank: 2, stated: true, pos,
        occurrence: {
          kind: "period",
          date: toIsoDate(start, 1, 1),
          endDate: toIsoDate(start + 9, 12, 31),
          provenance: `stated "${text0}", taken as the ${start}s`,
        },
      });
    };
    for (const m of text.matchAll(/\bthe\s+'?((?:1[89]|20)\d)0s\b/gi)) {
      pushDecade(m.index, m[0], null, Number(m[1]) * 10);
    }
    for (const m of text.matchAll(/\bthe\s+'?(\d{1,2})0s\b/gi)) {
      const n = Number(m[1]);
      pushDecade(m.index, m[0], String(n).endsWith("0") ? n : n * 10, null);
    }
    const decadeWordRe = new RegExp(String.raw`\bthe\s+(twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b`, "gi");
    for (const m of text.matchAll(decadeWordRe)) {
      pushDecade(m.index, m[0], DECADE_WORDS[m[1]!.toLowerCase()] ?? null, null);
    }

    // --- Age alone: "when I was 8" → period spanning that year of life (birthday to birthday) ---
    if (birth) {
      for (const a of ageMentions) {
        const start = addYears(birth, a.age);
        const end = dayBefore(addYears(birth, a.age + 1));
        candidates.push({
          rank: 2, stated: false, pos: a.pos,
          occurrence: {
            kind: "period", date: iso(start), endDate: iso(end),
            provenance: `age ${a.age}, from birthdate`,
          },
        });
      }
    }

    // --- "when I was in high school" → period Sep(14) – Jun(18), from birthdate ---
    if (birth && /\bin\s+high\s+school\b|\bhigh\s+school\s+(?:years|days)\b/i.test(text)) {
      candidates.push({
        rank: 2, stated: false, pos: text.search(/high\s+school/i),
        occurrence: {
          kind: "period",
          date: toIsoDate(birth.y + 14, 9, 1),
          endDate: toIsoDate(birth.y + 18, 6, 30),
          provenance: "high school years, from birthdate",
        },
      });
    }

    // --- Wars: named wars are stated periods; bare "the war" is taken as WWII when the narrator
    //     was alive for it (the family-history default), otherwise left unresolvable. ---
    const pushWar = (pos: number, text0: string, war: (typeof WARS)[keyof typeof WARS], stated: boolean, provenance: string) => {
      candidates.push({
        rank: 2, stated, pos,
        occurrence: {
          kind: "period", date: iso(war.start), endDate: iso(war.end), provenance,
        },
      });
    };
    let warMatched = false;
    for (const m of text.matchAll(/\bworld\s+war\s+(?:ii|two|2)\b|\bwwii\b|\bww2\b/gi)) {
      warMatched = true;
      pushWar(m.index, m[0], WARS.wwii, true, `"${m[0]}", taken as ${WARS.wwii.label}`);
    }
    for (const m of text.matchAll(/\bworld\s+war\s+(?:i|one|1)\b|\bwwi\b|\bww1\b/gi)) {
      warMatched = true;
      pushWar(m.index, m[0], WARS.wwi, true, `"${m[0]}", taken as ${WARS.wwi.label}`);
    }
    for (const m of text.matchAll(/\bkorean\s+war\b/gi)) {
      warMatched = true;
      pushWar(m.index, m[0], WARS.korea, true, `"${m[0]}", taken as ${WARS.korea.label}`);
    }
    for (const m of text.matchAll(/\bvietnam\b/gi)) {
      warMatched = true;
      pushWar(m.index, m[0], WARS.vietnam, true, `"${m[0]}", taken as ${WARS.vietnam.label}`);
    }
    if (!warMatched && birth) {
      for (const m of text.matchAll(/\b(?:during|in|through)\s+the\s+war\b/gi)) {
        if (birth.y <= WARS.wwii.end.y) {
          pushWar(m.index, m[0], WARS.wwii, false, `"${m[0]}", taken as World War II from birthdate`);
        }
      }
    }

    // --- Grade references: "in 8th grade" → circa birth+13/14 (point at the 14th birthday) ---
    if (birth) {
      const pushGrade = (pos: number, grade: number) => {
        if (grade < 1 || grade > 12) return;
        candidates.push({
          rank: 1, stated: false, pos,
          occurrence: {
            kind: "circa", date: iso(addYears(birth, grade + 6)), endDate: null,
            provenance: `${ordinalSuffix(grade)} grade (age ${grade + 5}–${grade + 6}), from birthdate`,
          },
        });
      };
      for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\s+grade\b/gi)) {
        pushGrade(m.index, Number(m[1]));
      }
      const gradeWordRe = new RegExp(String.raw`\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+grade\b`, "gi");
      for (const m of text.matchAll(gradeWordRe)) {
        pushGrade(m.index, ORDINALS[m[1]!.toLowerCase()] ?? 0);
      }
      for (const m of text.matchAll(/\bgrade\s+(\d{1,2})\b/gi)) {
        pushGrade(m.index, Number(m[1]));
      }
    }

    // --- Anchor-relative: "about ten years after we married" → circa against the life event ---
    const anchorRe = new RegExp(
      String.raw`\b(?:about\s+|around\s+|roughly\s+)?(${NUM})\s+years?\s+(after|before)\s+(?:(?:we|i|the|our|my)\s+)*(married|wed|wedding|graduated|graduation|moved|move|enlisted|army|navy|marines|military|service)\b`,
      "gi",
    );
    for (const m of text.matchAll(anchorRe)) {
      const n = toNumber(m[1]!);
      const kind = ANCHOR_WORDS[m[3]!.toLowerCase()];
      if (n === null || n < 0 || n > 100 || !kind) continue;
      const anchor = lifeEvents.find((e) => e && e.kind === kind);
      const anchorDate = anchor ? parseIso(anchor.date) : null;
      if (!anchorDate) continue; // no such anchor → the reference can't resolve
      const point = addYears(anchorDate, m[2]!.toLowerCase() === "after" ? n : -n);
      candidates.push({
        rank: 1, stated: false, pos: m.index,
        occurrence: {
          kind: "circa", date: iso(point), endDate: null,
          provenance: `"${m[0]}", from the ${ANCHOR_LABEL[kind]} life event`,
        },
      });
    }

    if (candidates.length === 0) return UNRESOLVABLE;

    // Precedence: date > period > circa; stated beats derived; earliest mention wins ties.
    candidates.sort((a, b) =>
      b.rank - a.rank ||
      Number(b.stated) - Number(a.stated) ||
      a.pos - b.pos,
    );
    return { status: "resolved", occurrence: candidates[0]!.occurrence };
  } catch {
    // Tolerant by contract: a resolver that throws would take down the interview turn.
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
  spans.push({ pos, end: pos + matched.length, text: matched });
  candidates.push({
    rank: 3, stated: true, pos,
    occurrence: {
      kind: "date", date: toIsoDate(year, month, day), endDate: null,
      provenance: `stated date "${MONTH_LONG[month - 1]} ${day}, ${year}"`,
    },
  });
}

function nearest<T extends Mention>(h: Mention, ms: T[]): T | null {
  let best: T | null = null;
  for (const m of ms) {
    if (best === null || dist(h, m) < dist(h, best)) best = m;
  }
  return best;
}

function dist(a: Mention, b: Mention): number {
  return Math.abs(a.pos - b.pos);
}

/** The holiday date on which the narrator (born `birth`) was exactly `age` years old. */
function holidayInAgeYear(birth: Ymd, age: number, md: [number, number] | "thanksgiving"): Ymd | null {
  const [hm, hd] = md === "thanksgiving" ? [11, 22] as const : md;
  // If the holiday falls before the birthday in the calendar year, the narrator turns `age`
  // AFTER it — the age-year's holiday is in the following calendar year.
  const beforeBirthday = hm < birth.m || (hm === birth.m && hd < birth.d);
  const y = birth.y + age + (beforeBirthday ? 1 : 0);
  const day = md === "thanksgiving" ? thanksgivingDay(y) : hd;
  if (!isRealCalendarDate(y, hm, day)) return null;
  return { y, m: hm, d: day };
}
