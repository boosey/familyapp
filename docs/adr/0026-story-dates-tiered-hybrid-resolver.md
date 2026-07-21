# ADR-0026 — Story dates: a tiered-hybrid resolver (stated calendar in code, soft language via an LLM ref → calculator)

Status: Accepted (2026-07-21)

Supersedes the write-authority of the original omnibus `resolveStoryDate` (#242). Related: ADR-0013
(the follow-up cascade this rides in), issues #243 (live derivation), #245 (life-event capture),
#246 (finish-time backstop), #248 (occurred_* is the one source of truth).

## Context

A Story carries at most one date in one of three forms — `date` (a day), `period` (a span), or
`circa` (an approximate point) — plus a plain-language provenance note. Nothing else on the Timeline
is load-bearing the way this is: a **confidently-wrong** date is worse than no date, because it
silently mis-places a memory and the narrator has no reason to distrust it.

The first implementation (`resolveStoryDate`, #242) was a single deterministic regex pass that tried
to do everything: stated calendar forms **and** soft language — bare ages, "8th grade", "the war",
"the 50s", "about ten years after we married". The soft-language heuristics were the problem:

- **"the war" → WWII**, **"the 50s" → the 1950s**, a bare place name → an era: each is a *guess*
  dressed as a fact, and each writes a date with no human in the loop.
- A bare **age**/**grade**/**holiday-at-age** computed a date from the birthdate with real arithmetic
  but a fabricated premise (that "when I was 8" is *the* date of the story rather than context).
- These fired **silently on the live interview path**, so a wrong date landed before anyone could
  object.

The natural fix is to let an LLM interpret soft language — but an LLM ISO date is exactly the thing we
must not trust on the Timeline. So the question is not "code vs. LLM" but *which half of the job each
does*.

## Decision

Split the date job by **recognition vs. arithmetic**, in three tiers.

### Tier A — `resolveStatedStoryDate` (deterministic, no LLM)

A NARROW parse of the **stated calendar only**:

- full date ("December 25, 1943", "25 December 1943") → `date`
- month + year ("December 1943") → `period` (that month)
- bare year ("1958") → `period` (that year)
- explicit four-digit decade ("the 1950s" / "1950s") → `period` (that decade)

That is the whole of Tier A. Every soft-language heuristic from the old resolver is **deleted, not
demoted**: no bare age, no grade, no holiday-at-age, no anchor-relative math, no life-stage, no bare
"the war", and — critically — no `"the 50s"` century guess and no word decades ("the fifties"). Tier A
is the ONLY resolver on the **live interview path** (#243): if the narrator states the calendar, we
auto-date immediately; otherwise the story stays Undated and flows to the one temporal ask / the
finish backstop. No guess lands silently.

### Tier B — a structured `TemporalRef` → the pure `resolveTemporalRef` calculator

Soft language is handled by splitting the labor:

- an **LLM recognizes** the reference and emits a structured `TemporalRef` from a **closed catalog**
  (`age`, `grade`, `holiday_at_age`, `holiday_in_year`, `month_at_age`, `life_stage`,
  `years_from_anchor`, `named_era`, `season_*`, plus the stated forms). It never states a date.
- **our code does every calendar computation** in the pure `resolveTemporalRef`, gated on real anchors
  (`birthDate`, known life events) and closed allowlists (holidays, eras with FIXED spans, life-stage
  and season policy). The model's own `hintedOccurrence` is **ignored** — the calculator alone owns
  the value and the form. Precision is never invented: an age is a period/`circa`, hedged language is
  `circa`, only a genuine day-level ref is a `date`.

A defensive parser (`parseTemporalProposal`) validates the model JSON against those allowlists;
anything unknown or malformed degrades to `unresolvable`. We **persist only** when the recognition is
`resolved`, confidence is not `low`, AND the calculator actually resolves.

### Where Tier B runs (and where it does not)

Tier B is a **finish-time backstop** (#246), for **Undated stories only**:

- the pipeline **render stage** (background) and the web **finishDraft** action both run Tier A over
  the final text first; only if that misses do they consult the Tier B recognizer, then the
  calculator. A resolved value is written through the same `applyResolvedStoryDate` seam the live path
  uses, and its provenance note carries a `(finish-time backstop)` marker so a reader can tell which
  path produced it. The `occurredKind === null` gate means a date set live during the interview is
  **never** overwritten.

Tier B does **not** run on the live interview turn loop. The live path is Tier A + the single
deterministic **temporal ask** (`createTemporalFollowUpProbe`, one per story via a latch): when the
date is unresolved we may ask once, but the ask **invents nothing** — a skip or "I don't know" leaves
the story Undated for the backstop. This keeps the interview a controlled loop and keeps the one
place that guesses (the LLM recognizer) off the live path and out of the Timeline's trust boundary.

### Life-event capture bar (#245)

`extractStatedLifeEvents` records an anchor fact ("we married in '58") only from a **stated calendar**
form tied to an anchor word within the same clause, and only when it asserts a NEW fact — an
anchor-relative *reference* ("ten years after we married") records nothing. Same discipline as Tier A:
a wrong anchor silently corrupts later derivations, so capture errs toward under-capture.

## Consequences

- **The Timeline stops lying.** Nothing writes a date the narrator did not state unless a confident
  LLM recognition + a deterministic calculation agree, and even then only at finish, never silently
  mid-interview.
- **One temporal path.** There is a single dating follow-up (the system probe in the ADR-0013
  cascade); the old inline `proposeTemporalFollowUp` is gone.
- **Cost.** The finish backstop now spends one short LLM recognizer call per still-Undated story
  (alongside the metadata call that already runs there). Stated-calendar stories cost nothing extra
  (Tier A short-circuits before the model).
- **Testability.** Tier A, the Tier B calculator, and the parser are pure and exhaustively table-tested
  in `@chronicle/core`; the loop/seam behavior is tested with in-memory sinks and a scripted model.
- **`occurred_*` is the single source of truth** (#248); `eraYear` is retired (its migration backfills
  legacy era years into year-aligned periods, 0029).

## Rejected alternatives

- **Keep the omnibus regex, just soften it.** Rejected: "demoting" a heuristic still leaves it writing
  guesses. The heuristics had to be deleted from write-authority, not tuned.
- **Trust an LLM-emitted ISO date.** Rejected: that is precisely the unauditable, confidently-wrong
  write we are trying to eliminate. The model recognizes; the calculator decides.
- **Run Tier B live on every turn.** Rejected: it puts a guessing LLM inside the controlled loop and
  on the request path, and risks silently dating a story mid-interview. Live stays Tier A + ask;
  interpretation happens once, at finish.
