# Recommendation: Reconcile Story dates, gap detection, and richness

**Status:** Planning input (not an ADR yet)  
**Audience:** Agent planning the reconciliation of dating, gaps, and deepen/richness  
**Date:** 2026-07-21  
**Related:** [#238](https://github.com/boosey/familyapp/issues/238) (Story dates PRD), [#239](https://github.com/boosey/familyapp/issues/239) (epic), ADR-0013 (follow-up cascade), `feat/story-dates` worktree (`resolveStoryDate`), master cascade hook (`createTemporalFollowUpProbe` / PR #249)

---

## 1. Verdict (read this first)

**Do not scrap the deterministic date resolver for a pure-LLM solution.**  
**Do not build a continuous “LLM teaches the resolver until 80%” self-improvement system.**  
**Do not merge date resolution, gap detection, and richness/deepen into one mega-pass.**

**Do** adopt a **tiered hybrid** — this is **not** an LLM-only dating system:

1. Keep a **narrow deterministic layer** for *safe* stated calendar forms only (Tier A).
2. For relative/era/ambiguous language (Tier B): **LLM recognizes and emits structured temporal refs/slots**; a **pure deterministic calculator** (reusing/shrinking today’s date-math) turns `(birthDate, lifeEvents, ref)` into `date | period | circa`. Code validates and alone decides persist. **Do not trust the LLM to perform calendar arithmetic or to emit the authoritative ISO occurrence.**
3. Keep **gap** and **richness** as separate cascade stages (ADR-0013); enrich the temporal *channel* so dating and “should we ask when?” share one truth, instead of racing.

Inference cost on short narratives is **not** the deciding factor. Wrong confident Timeline dates are.

**Split of labor (binding):** recognition/soft language → LLM; date math + write gate → code.

---

## 2. Problem this reconciles

### What landed / is landing

- **Story dates (`feat/story-dates`):** a pure regex/rules `resolveStoryDate(text, birthDate, lifeEvents)` that persists `occurred_*` + provenance, plus one temporal follow-up when unresolvable, plus a finish-time backstop that **re-runs the same resolver** (no LLM), despite the PRD/#246 describing an LLM-shaped backstop.
- **Gaps (issue #80):** thin LLM pass naming missing facts (`temporal | relational | spatial | causal | identity`); proposes only; `decideFollowUp` disposes.
- **Richness/deepen:** free-form interestingness evaluator (cascade stage 3).
- **Master cascade (ADR-0013 amendment):** system probes → gap → deepen. Temporal dating probe is deterministic and stays dark without `dating` context.

### Why UX is at risk

The deterministic resolver was written as if a closed idiom list ≈ product success. Real oral history will often miss patterns; worse, several high-confidence heuristics **false-positive** (e.g. bare `vietnam` → war period; bare `the war` → WWII; decade century guesses; hedged “about 8” stored as a tight birthday span). Readers see Timeline order first, not provenance. Silent life-event capture can poison later derivations with no profile UI.

Separately, **gap LLM can still propose temporal after rules already dated** (gap runs before derive in the story-dates turn loop) — wasting the at-most-one ask and training “the app didn’t hear me.”

### What “good” means here

- Narrator: dated when their words support it; asked at most once, gently; never badgered; never blocked on a date.
- Reader: Timeline mostly honest; Undated explicit; **confidently wrong placement is worse than empty**.
- System: auditable propose→dispose; no chatbot control; dating writes go through the story write seam with provenance; life events don’t silently corrupt the graph.

---

## 3. Options considered (and rejected)

| Option | Verdict | Why |
|--------|---------|-----|
| Scrap resolver; LLM-only dating (model emits final ISO occurrence) | **Reject** | Better recall on phrases, unreliable on calendar math and precision honesty; harder to test; still needs the same pure calculator afterward. |
| LLM returns final `occurrence` ISO dates as source of truth (even in a “hybrid”) | **Reject** | Same math/precision failure mode. Model may draft a hint date for debugging; **code must recompute** (or reject) before persist. |
| Continuous self-improvement (LLM checks resolver → grow rules to 80%+) | **Reject** | Second product (corpus, labels, promotion, drift). “80%” will be gamed by the suite. Not worth it unless dating accuracy is a funded research track. |
| Cost/speed of rules as the primary decision driver | **Reject as primary** | On short takes, LLM cost is negligible vs trust damage from a wrong year on Timeline. |
| One structured pass for time + gap + richness | **Reject** | Fights ADR-0013. Mixes “write archive fact” with “ask next?” and “what’s interesting?” Softens gates; mushy audits. |
| Keep current resolver as full write-authority | **Reject** | Trust-negative for readers; heuristics too aggressive. |

---

## 4. Recommended architecture

### 4.1 Three jobs stay three jobs

| Job | Output | Who decides persist / ask |
|-----|--------|---------------------------|
| **Date resolve** | Optional `occurred_*` + provenance + unresolved flag | **Code**: Tier A parse and/or Tier B `ref → calculator`; code alone persists |
| **Gap propose** | Candidate follow-up seeds (incl. temporal only if still unresolved) | `decideFollowUp` + cascade |
| **Richness / deepen** | Interestingness candidates | `decideFollowUp` + cascade |

Shared orchestration remains: **system probes → gap → deepen** (ADR-0013). Dating is a **fact channel** that *feeds* the temporal probe / gap temporal eligibility — not a fourth conversational brain.

### 4.2 Tiered dating (hybrid)

| Tier | Input class | Engine | Persist policy |
|------|-------------|--------|----------------|
| **A — Safe stated calendar** | Explicit `YYYY`, `Month YYYY`, full calendar date, explicit `1950s` / `the 1950s` | Narrow **deterministic** parse (keep/shrink today’s resolver) — no LLM | Persist immediately with provenance `stated …` |
| **B — Relative / era / hedged** | Soft temporal language covered by the §4.3 `TemporalRefType` catalog | **LLM → structured `TemporalRef`** → **pure calculator** | Persist **only if** calculator succeeds and precision rules pass; hedges → `circa` or `period`, never exact `date` unless day-level ref |
| **C — Nothing usable** | No temporal signal, or low confidence / calculator cannot resolve (e.g. age ref, no birthdate) | No write | `dateStatus = unresolved` → existing one temporal ask / Undated |

**Demote or delete from write-authority today:** bare `vietnam`, bare `the war` → WWII default, short-decade century guesses, any path that invents day-level precision from age alone without a holiday/stated day. Those must not stay as silent regex writes; if kept at all, they become named refs the calculator understands (e.g. `war: "vietnam"` only when the war is *named*), or they stay unresolved.

### 4.3 Tier B contract: LLM refs, code math (binding)

**Do not** treat an LLM-emitted ISO `occurrence` as source of truth.  
**Do** have the model emit a temporal **reference**; code (or an in-process “tool” that is just a pure function) does the math.

Preferred packaging for this repo: `LanguageModel.complete` + `responseFormat: "json"` returning slots (same tradition as gap/metadata). A multi-step tool-calling agent is optional sugar only if tools are already house style — the tool **body** must still be the deterministic calculator.

Unknown `type` / unknown allowlist value / missing required slots → treat as unresolved (never invent a new type at runtime). Prefer **one primary `ref`** per telling for v1 (earliest / highest-confidence); multi-ref ranking can wait.

#### `TemporalRefType` — v1 exhaustive catalog

| `type` | Example phrase | Required slots | Typical form | Needs |
|--------|----------------|----------------|--------------|-------|
| `stated_full_date` | “December 25, 1943” | `year`, `month`, `day` | `date` | — |
| `stated_month_year` | “December 1943” | `year`, `month` | `period` (month-aligned) | — |
| `stated_year` | “in 1958” | `year` | `period` (year-aligned) | — |
| `stated_decade` | “the 1950s” / “the fifties” | `decadeStartYear` (e.g. 1950) | `period` (decade) | — |
| `holiday_in_year` | “Christmas of 1958” | `holiday`, `year` | `date` | — |
| `holiday_at_age` | “when I was 8, for Christmas” | `holiday`, `age` | `date` | birthDate |
| `month_at_age` | “in June when I was 10” | `month`, `age` | `period` (that month in age-year) | birthDate |
| `age` | “when I was 8” | `age` | `period` (birthday→next) or `circa` if `hedge` | birthDate |
| `grade` | “in 8th grade” | `grade` (1–12) | `circa` | birthDate |
| `life_stage` | “when I was in high school” | `lifeStage` | `period` (stage span) | birthDate |
| `years_from_anchor` | “about ten years after we married” | `anchorKind`, `offsetYears` | `circa` | matching life event |
| `named_era` | “during World War II” | `era` | `period` (fixed span) | — |
| `season_in_year` | “summer of ’62” | `season`, `year` | `period` (season bounds) | — |
| `season_at_age` | “the summer I turned 16” | `season`, `age` | `period` | birthDate |

**Not in v1** (model must emit `dateStatus: "unresolved"` / `ambiguous`, not a fake type): bare place-names as eras (`vietnam` without “war”), bare “the war”, open-ended “after we married” with no year count, seasons alone with no year/age, fuzzy “between 1943 and 1945” ranges, multi-anchor disambiguation (“which wedding?”).

#### Allowlists (closed; calculator-owned)

```ts
type HolidayId =
  | "christmas_eve" | "christmas"
  | "new_years_eve" | "new_years_day"
  | "halloween" | "valentines_day"
  | "fourth_of_july" | "thanksgiving";

type LifeStageId =
  | "elementary_school"   // ~age 5–11 (calculator policy)
  | "middle_school"       // ~age 11–14
  | "high_school"         // ~age 14–18 (existing: Sep 14 → Jun 18)
  | "college"             // ~age 18–22
  | "young_adult"         // optional coarse bucket; prefer unresolved if unused in v1 calc
  ;

type EraId =
  | "wwi" | "wwii" | "korea" | "vietnam"
  // add further named eras only with fixed calculator spans; no open string
  ;

type SeasonId = "spring" | "summer" | "fall" | "winter";

type AnchorKind = "wedding" | "graduation" | "military_service" | "move" | "other";
```

Tier A may short-circuit `stated_*` / explicit decade without an LLM. The LLM may still emit those types when they appear inside a longer soft telling; the calculator handles them identically.

#### Envelope + ref shape

```ts
type TemporalRefType =
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

interface TemporalRef {
  type: TemporalRefType;
  // calendar slots (1–12 month, 1–31 day, four-digit year)
  year?: number;
  month?: number;
  day?: number;
  decadeStartYear?: number; // 1950 for "the 1950s"
  // relative slots
  age?: number;             // 0–110
  grade?: number;           // 1–12
  holiday?: HolidayId;
  lifeStage?: LifeStageId;
  era?: EraId;              // named wars / fixed eras only
  season?: SeasonId;
  anchorKind?: AnchorKind;
  offsetYears?: number;     // +10 / -3 for years_from_anchor
  hedge?: boolean;          // about / around / sometime / I think
  // Optional debug hint ONLY — ignore for persist if it disagrees with the calculator
  hintedOccurrence?: {
    kind: "date" | "period" | "circa";
    date: string;
    endDate?: string | null;
  };
}

interface TemporalProposal {
  dateStatus: "resolved" | "unresolved" | "ambiguous";
  confidence: "high" | "medium" | "low";
  ref?: TemporalRef;
  // Stated anchor facts for capture (separate, stricter persist gate) — years/dates the
  // narrator asserted, not computed relative refs
  statedLifeEvents?: Array<{
    kind: AnchorKind;
    date: string; // ISO YYYY-MM-DD or year YYYY the narrator stated
    provenance: string;
  }>;
}
```

**Pipeline for Tier B (non-negotiable):**

1. LLM → parse/defensively validate `ref` (unknown `type` / allowlist miss / missing required slots → unresolved).
2. Pure `resolveTemporalRef({ birthDate, lifeEvents, ref })` → `StoryDateOccurrence | unresolvable`  
   (reuse/extend date math from today’s `resolve-story-date.ts`: holidays, age spans, years-after-anchor, life-stage bounds, season bounds, etc.).
3. If calculator result and `hintedOccurrence` disagree → **trust the calculator**; log/drop the hint.
4. Precision / hedge gates (below) → maybe persist.

**Code hard-rules before persist (non-negotiable):**

- Calculator cannot resolve (missing birthdate/anchor, bad slots) → unresolved; never invent.
- Invalid calendar from calculator → drop (treat as unresolved).
- `kind: "date"` only for `stated_full_date`, `holiday_in_year`, `holiday_at_age` (and similar day-level refs) — `age` / `grade` / `life_stage` alone are period/circa, never a fake day.
- `ref.hedge === true` or hedge language ⇒ not `date`; prefer `circa`.
- `confidence: "low"` or `dateStatus: "ambiguous"` ⇒ **do not auto-persist** (Undated or ask once).
- `named_era` only for allowlisted `EraId`; never map bare place-names.
- Never invent anchors; life-event writes need the same or stricter gate (prefer confirm-or-high-confidence-only in v1).
- Provenance is **authored by code** from the ref + anchors (e.g. `age 8 at Christmas, from birthdate`), not free-form model prose as sole authority. Model prose may inform wording only if it matches the computed derivation.
- Provenance must name the path (`stated`, `from birthdate`, `from wedding life event`, `llm-ref + calculator`, `finish-time backstop`, etc.).

**Calculator coverage note:** today’s `resolve-story-date.ts` already implements most of the table (stated calendar, age, holiday+age/year, grade, high school, named wars, years-from-anchor). Gaps to add when wiring Tier B: `month_at_age`, season bounds, elementary/middle/college stage policies, and rejecting bare-`vietnam` / bare-`the war` that the old regex allowed.
### 4.4 Where the LLM call lives

**Prefer extending an existing paid pass**, not adding a third always-on call:

**Preferred:** extend the **gap-detection structured output** (live) and/or **finish-time metadata / story-date backstop** (silent) with the optional `ref` / `dateStatus` fields above (not a final ISO occurrence).

- Live: after each eligible take, one structured read can both (a) propose gaps and (b) propose a temporal **ref**.
- Code then: `resolveTemporalRef` → validate → maybe persist; set `dating.dateUnresolved`; run cascade. Temporal system probe / gap-temporal only if still unresolved.
- Finish: LLM emits refs (same contract) **only for still-Undated** stories (restore PRD/#246 intent); calculator + provenance marker `finish-time backstop`; never overwrite a human edit or a higher-confidence live date.

**Alternative (acceptable):** a dedicated `proposeTemporalRef(llm, …)` seam parallel to `deriveMetadata`, then the same pure calculator — still propose-only; still no LLM write authority.

**Packaging note:** in-process pure function after JSON slots is enough. Explicit tool calls (`resolve_age_at_holiday`, …) are fine iff each tool is that same calculator — the model must not “answer” the tool’s numeric/ISO result itself.

**Not acceptable:** LLM emits authoritative ISO dates and code only schema-checks them; LLM silently writes dates; LLM owns follow-up selection.

### 4.5 Cascade / probe wiring (fix the race)

1. Run Tier A and/or Tier B (ref → calculator → persist gate) **before** deciding whether temporal is eligible (or in the same structured LLM result as gaps, then dispose in code order: calculator → persist gate → set unresolved flag → cascade).
2. If an occurrence was persisted this turn → **do not** ask temporal (suppress system probe and ignore/drop gap candidates with `kind: "temporal"` for that turn).
3. Keep at-most-once temporal latch; skip / “I don’t know” terminal; Undated first-class.
4. System probe remains deterministic: it only fires on `dateUnresolved && !alreadyAsked` — it does not re-implement dating or date math.

### 4.6 Life events

- Keep capture as a **by-product** of dating (no profile UI in v1), but **raise the bar**: only persist stated anchor facts with explicit year/date and high confidence; do not infer “married in ’58” from weak prose.
- Captured events still load next session as anchors (documented); do not mutate mid-session snapshot unless you explicitly design for it.
- Wrong life event is worse than missing — prefer under-capture.

### 4.7 What to keep from the current resolver

**Split today’s `resolveStoryDate` — do not throw the calculator away:**

- **Tier A front door:** full calendar dates, month+year, bare year, explicit four-digit decades (deterministic parse; no LLM).
- **Shared calculator backend:** age/holiday/anchor/life-stage/war math extracted as `resolveTemporalRef` (or equivalent) for Tier B refs — this is the valuable deterministic IP.
- Shared occurrence types (`date | period | circa`), provenance string, Undated null kind.
- Repository write seam (`applyResolvedStoryDate` / edit control) and display formatter rules.
- Product rules: never invent precision; date > period > circa when multiple forms; Undated OK.

**Remove as silent regex write-authority:** relative/era phrase matching that currently lives in `resolve-story-date.ts` on `feat/story-dates`. Phrase recognition moves to the LLM ref; math stays in the calculator.

---

## 5. Explicit non-goals

- Self-improving regex farm / coverage% KPI driving merges.
- Open-chat interviewer; model-selected next question without `decideFollowUp`.
- Live recompute of all story dates when birthdate changes (stored values + provenance stay).
- EDTF / fuzzy “between 1943 and 1945” uncertainty model beyond the three forms.
- Merging richness scoring into the dating JSON as a required field.
- Trusting the LLM for calendar arithmetic or authoritative ISO occurrence emission.

---

## 6. Suggested planning breakdown (for the implementing plan)

Order is dependency-aware; adjust ticket sizes as needed.

1. **Policy ADR / DECISIONS amendment** — Record tiered hybrid + **LLM=refs / code=math** split; reject pure-LLM dating, LLM-as-ISO-source-of-truth, self-improve farm, mega-pass; note ADR-0026 gap (cited by #238 but missing in-tree) must be written or replaced.
2. **Extract pure calculator + shrink phrase write-authority** — Tier A stated parse stays; relative regex matching loses silent persist; date math becomes `resolveTemporalRef`; tests for “must not persist” (vietnam place-name, bare war, hedged age as exact date, etc.).
3. **Structured temporal-ref seam** — LLM JSON ref contract + defensive parser; ScriptedLanguageModel tests (derive-metadata tradition); calculator unit tests remain table-driven (no LLM).
4. **Wire live path** — Prefer gap-output extension or dedicated `proposeTemporalRef`; ref → calculator → persist gate; set `dating` from real resolution state.
5. **Fix temporal race** — Persisted occurrence suppresses temporal ask same turn; latch semantics unchanged.
6. **Finish-time backstop** — LLM refs for still-Undated only; same calculator; provenance marker; never overwrite better live/human dates (#246 intent restored, math still deterministic).
7. **Life-event capture gate** — High bar; tests for under-capture preference.
8. **Leave richness/deepen alone** except cascade ordering / shared context if needed — do not fold into dating.

---

## 7. Acceptance criteria (planning-level)

- [ ] Stated calendar forms still auto-date without an LLM (Tier A).
- [ ] Relative/era forms date only via **LLM ref → deterministic calculator** (or stay Undated) — no silent war/place false positives from regex phrase matching.
- [ ] LLM-emitted ISO hints are never persisted when they disagree with the calculator; calculator is source of truth for bounds.
- [ ] Hedge language cannot land as exact `date`.
- [ ] Low confidence / ambiguous / calculator miss ⇒ no auto-persist.
- [ ] If a date was persisted this turn, no temporal follow-up is asked.
- [ ] At most one temporal ask per story; skip / don’t-know terminal.
- [ ] Finish backstop uses LLM **refs** + same calculator only for still-Undated; provenance identifies path.
- [ ] Gap and deepen remain separate cascade stages; decision ledger still auditable.
- [ ] Reader-facing Timeline never requires trusting provenance to avoid obvious mis-buckets from known heuristic bugs.

---

## 8. Context the planning agent should read

- This file.
- [#238](https://github.com/boosey/familyapp/issues/238) PRD (especially Slice 3 vs Slice 4 tension: pure live resolver vs LLM-shaped backstop).
- `docs/adr/0013-interviewer-consults-an-auditable-llm-evaluation.md` (cascade invariant).
- `docs/DECISIONS.md` § Follow-up cascade.
- Worktree `feat/story-dates`: `packages/core/src/resolve-story-date.ts`, interviewer `deriveAndPersistStoryDate` / temporal follow-up, `packages/pipeline/src/derive-story-date.ts`.
- Master: `createTemporalFollowUpProbe`, `proposeAndDisposeFollowUp`, gap-detection output contract.

---

## 9. One-line brief for the planner

**Tiered hybrid dating: deterministic Tier A for stated calendar; Tier B = LLM structured temporal refs → pure calculator (never LLM ISO as source of truth); feed unresolved into ADR-0013 cascade; finish backstop = same ref+math for Undated only; keep gap and richness separate — do not scrap for pure LLM, do not build a self-improving resolver, do not mega-merge the three jobs.**
