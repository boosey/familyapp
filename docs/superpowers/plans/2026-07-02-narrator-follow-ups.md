# Narrator AI Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a narrator answers an Ask (mid-capture, on `apps/web/app/hub/answer/[askId]`), the interviewer evaluates the take's transcript and may ask up to 2 gentle deepening **follow-up** questions in the same sitting; the initial answer plus its follow-up answers become **one multi-take Story with a single approval**. Every follow-up decision is written to an append-only audit record. The whole feature is gated behind a resolved `FollowUpPolicy` config whose `enabled` flag is off by default, so it lands dark.

**Architecture:** A **propose-then-dispose** split (ADR-0013): a new `FollowUpEvaluator` seam (LLM, prompts-as-data) only *proposes* ranked tagged candidates; a pure `decideFollowUp` function in `behavior.ts` *enforces* the caps / rapport gate / distress short-circuit / anti-repeat / emotional-door veto and picks one. A follow-up thread resolves to one Story with an ordered `story_recordings` set of Takes (ADR-0012); `stories.recordingMediaId` is **retained** as the take-0 pointer (preserving the immutability trigger and every existing read path), and `story_recordings` *supplements* it as the full ordered set including take 0. Per-take transcription happens as each take is recorded; the expensive prose polish runs **once** over the stitched transcript at thread completion. When the flag is off, `recordAnswerAction` is byte-for-byte today's one-shot path.

**Tech Stack:** TypeScript (ESM, strict, `noUncheckedIndexedAccess`), pnpm workspaces; Drizzle + Postgres (PGlite in tests); Vitest; Next.js 15 / React 19 server actions + client components; Kindred design-system CSS tokens.

**Design records (authoritative — read before building):**
- `docs/adr/0012-follow-up-thread-is-one-multi-take-story.md` — the multi-take Story + schema shape.
- `docs/adr/0013-interviewer-consults-an-auditable-llm-evaluation.md` — the evaluator split + decision record.
- `CONTEXT.md` — glossary: **Take**, multi-take **Story**, **Follow-up**, **Emotional-door rule**, **Follow-up thread**, **Follow-up decision record**.

**Two things the design close flagged (do not regress):**
1. The **hub-session cap** (`maxFollowUpsPerSession`) is nearly inert in v1 (one Ask = one thread). Include it in the policy + test it as a pure function, but do **not** build UI/telemetry theater implying it's exercised in the normal path.
2. The evaluator is **on the critical path to sharing an answer** — each follow-up adds a transcribe→evaluate round-trip before the narrator can finish. This is a dignity issue for an elderly narrator watching a spinner. Task 5 sets an explicit latency budget and **degrades to one-shot** on timeout/failure.

---

## Scope

**In scope (this plan):** the Ask-answer surface only (`apps/web/app/hub/answer/[askId]`), behind the `followUps` policy flag. The mechanism is written surface-agnostic (evaluator seam + `decideFollowUp` are pure interviewer logic) but only this one surface is wired.

**Out of scope (separate follow-on plan):** **Ask suggestions** (`askSuggestions` flag) — asker-side, compose-time coaching. Independent feature, independent flag; reuses the same audited-disposition shape. Written after this lands.

**Explicitly not wired:** base narration (`/s/[token]`) and intake inherit the multi-take model later when their turn-loop surface lands.

---

## Naming disambiguation (read once)

The interviewer already has a **dead** `follow_up` `PromptIntent` (`behavior.ts:112`, `behavior.ts:269`) — a crude "last utterance ≥12 words" reflect trigger, emitted only by `pickNextIntent`, which **no production surface calls** (the turn loop is not mounted anywhere). This plan does **not** route through `pickNextIntent`. It adds a *new* evaluator-driven decision path (`decideFollowUp`) that `recordAnswerAction` calls directly. The old `≥12-word` branch in `pickNextIntent` is left intact for the future turn-loop surface but is not the feature. The `phraser.ts` `case "follow_up"` (`phraser.ts:126`) IS reused — it already phrases a `{ kind: "follow_up"; threadSeed }` intent, and the mini-loop constructs exactly that intent to phrase a selected candidate.

---

## File Structure

**New files:**
- `packages/interviewer/src/follow-up-policy.ts` — `FollowUpPolicy` type, `DEFAULT_FOLLOW_UP_POLICY`, `resolveFollowUpPolicy(overrides?)`. One responsibility: the tunable policy object + its resolver.
- `packages/core/src/follow-up-record.ts` — append-only repo for the `follow_up_decisions` table: `appendFollowUpDecision`, `appendFollowUpOutcome`, `listFollowUpDecisionsForStory`, `latestUnresolvedDecision`. Operational tier (not behind the story front door).
- `apps/web/lib/follow-up-config.ts` — `resolveFollowUpPolicyForRequest()`: reads the `FOLLOW_UPS_ENABLED` env flag (mirrors the `isXConfigured()` idiom) and returns a resolved `FollowUpPolicy`. The single seam where a subscription tier would later inject overrides.
- `apps/web/app/hub/answer/[askId]/FollowUpPrompt.tsx` — presentational follow-up screen (prompt text + voice button + peer-level "That's all for now" finish button). One responsibility: the in-thread follow-up UI.

**Modified files:**
- `packages/db/src/schema.ts` — add `story_recordings` (ordered one-to-many) and `follow_up_decisions` (two-kind append-only) tables + enums.
- `packages/db/drizzle/schema.sql` — regenerated via `db:generate`.
- `packages/db/drizzle/invariants.sql` — add the `follow_up_decisions_append_only` trigger.
- `packages/interviewer/src/contracts.ts` — add the `FollowUpEvaluator` seam + its input/output types.
- `packages/interviewer/src/mocks.ts` — add `ScriptedFollowUpEvaluator`.
- `packages/interviewer/src/behavior.ts` — add `decideFollowUp` + its types (the code gates).
- `packages/interviewer/src/index.ts` — export the new policy, contracts, decision types, mock.
- `packages/pipeline/src/orchestrator.ts` — add `transcribeTakeToRecording` + `stitchAndRenderStory` (multi-take path); existing two-stage flow untouched.
- `packages/core/src/story-repository.ts` — `persistRecordingAndCreateDraft` also inserts take 0 into `story_recordings`; add `appendStoryRecording`, `listStoryRecordings`, `dropStoryRecording`.
- `packages/core/src/index.ts` — export the new story-recording + follow-up-record functions.
- `apps/web/app/hub/answer/[askId]/actions.ts` — `recordAnswerAction` gains the mini-loop; add `finishThreadAction`, `dropTakeAction`.
- `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx` — follow-up screen wiring + multi-take review (per-take relisten, drop-take, stitched prose).
- `apps/web/app/hub/answer/[askId]/page.tsx` — `DraftInfo` gains `takes[]`.
- `apps/web/app/_copy/hub.ts` — follow-up + multi-take copy strings.

**Regression tests (new):**
- `packages/db/test/story-recordings.test.ts` — ordering, cascade, take-0 insert, immutability of `follow_up_decisions`.
- `packages/interviewer/test/follow-up-policy.test.ts` — resolver defaults + overrides.
- `packages/interviewer/test/decide-follow-up.test.ts` — every disposition reason + emotional-door veto + ranking/tie-break.
- `packages/core/test/follow-up-record.test.ts` — append + outcome + latest-unresolved + append-only enforcement.
- `packages/pipeline/test/stitch-render.test.ts` — per-take transcribe + stitch order + single polish.
- `apps/web/__tests__/answer-follow-up-loop.test.tsx` — the mini-loop UI transitions (mocked media + actions).

---

## Task 0: Shared contracts (BLOCKING — must be committed before any parallel slice)

Per the "Shared Contracts First" rule: no other slice starts until these types are committed. Per the CLAUDE.md convention "domain enums/types and the Drizzle schema are the shared contract — defined in `@chronicle/db` and re-exported," the **persisted** follow-up payload types live in `@chronicle/db` (db depends on nothing, so no cycle). `@chronicle/interviewer` imports them and adds only *behavior* (the evaluator seam, the policy resolver, and later `decideFollowUp`). This task is types + a resolver + trivial tests — no behavior logic yet.

**Files:**
- Create: `packages/db/src/follow-up-types.ts`
- Modify: `packages/db/src/index.ts` (re-export the new types)
- Create: `packages/interviewer/src/follow-up-policy.ts`
- Modify: `packages/interviewer/src/contracts.ts` (append the evaluator seam)
- Modify: `packages/interviewer/src/index.ts` (exports)
- Test: `packages/interviewer/test/follow-up-policy.test.ts`

- [ ] **Step 1: Define the persisted domain types in `@chronicle/db`**

Create `packages/db/src/follow-up-types.ts`:

```ts
/**
 * Persisted domain types for narrator AI follow-ups (ADR-0012 / ADR-0013). These are the shared
 * contract: they are stored in the `follow_up_decisions` jsonb/enum columns AND consumed by
 * `@chronicle/interviewer` (evaluator seam + decision logic) and `@chronicle/core` (the append-only
 * repo). They live in `@chronicle/db` because it is the dependency root — no import cycle.
 */

/** The kind of thread a follow-up would pursue. `emotional` is gated by the emotional-door rule. */
export type FollowUpType = "factual" | "sensory" | "temporal" | "relational" | "emotional";

/** How sensitive pursuing this thread is. `high` requires rapport (code gate). */
export type FollowUpSensitivity = "low" | "medium" | "high";

/** One candidate thread the evaluator proposes. Title/summary tier — never raw transcript. */
export interface FollowUpCandidate {
  threadSeed: string;
  type: FollowUpType;
  sensitivity: FollowUpSensitivity;
  /** Model's self-assessed confidence [0..1]. */
  confidence: number;
  /** TRUE iff the narrator's OWN words surfaced the feeling first (emotional-door input). */
  narratorOpened: boolean;
}

/** The coded reason a candidate was kept or dropped — nothing is discarded without one. */
export type FollowUpDispositionReason =
  | "selected"
  | "thin_answer"
  | "distress_shortcircuit"
  | "over_cap_thread"
  | "over_cap_session"
  | "below_confidence"
  | "below_rapport"
  | "duplicate"
  | "emotional_door_closed"
  | "not_selected";

/** One candidate + what the deterministic picker did with it. */
export interface CandidateDisposition {
  candidate: FollowUpCandidate;
  reason: FollowUpDispositionReason;
  selected: boolean;
}

/** What the narrator did with an asked follow-up (the `outcome` row in the ledger). */
export type FollowUpOutcome = "answered" | "skipped" | "off_ramped";

/**
 * The resolved, tunable follow-up policy — snapshotted into each decision record for replay/audit.
 * Shape lives here (persisted); DEFAULT + resolver live in `@chronicle/interviewer`.
 */
export interface FollowUpPolicy {
  enabled: boolean;
  maxFollowUpsPerThread: number;
  maxFollowUpsPerSession: number;
  thinAnswerWordFloor: number;
  confidenceThreshold: number;
}
```

- [ ] **Step 2: Re-export from `packages/db/src/index.ts`**

Add near the other type re-exports:

```ts
export type {
  FollowUpType,
  FollowUpSensitivity,
  FollowUpCandidate,
  FollowUpDispositionReason,
  CandidateDisposition,
  FollowUpOutcome,
  FollowUpPolicy,
} from "./follow-up-types";
```

- [ ] **Step 3: Write the policy resolver in `@chronicle/interviewer`**

Create `packages/interviewer/src/follow-up-policy.ts`:

```ts
/**
 * FollowUpPolicy DEFAULT + resolver. The TYPE lives in `@chronicle/db` (persisted); the default
 * values and resolution logic live here. This is a RESOLVED OBJECT, never hardcoded constants
 * scattered through the loop (the user was emphatic): resolved once at session start and
 * subscription-ready — a future tier maps to a `Partial<FollowUpPolicy>` overrides bag.
 *
 * `enabled` defaults to FALSE so the feature lands dark. `decideFollowUp` (behavior.ts) applies the
 * caps + thresholds over the evaluator's proposed candidates.
 */
import type { FollowUpPolicy } from "@chronicle/db";

export type { FollowUpPolicy };

export const DEFAULT_FOLLOW_UP_POLICY: FollowUpPolicy = {
  enabled: false,
  maxFollowUpsPerThread: 2,
  maxFollowUpsPerSession: 4,
  thinAnswerWordFloor: 8,
  confidenceThreshold: 0.6,
};

export function resolveFollowUpPolicy(overrides?: Partial<FollowUpPolicy>): FollowUpPolicy {
  return { ...DEFAULT_FOLLOW_UP_POLICY, ...(overrides ?? {}) };
}
```

- [ ] **Step 4: Append the evaluator seam to `contracts.ts`**

At the end of `packages/interviewer/src/contracts.ts`, add (note the payload types are imported from db, not redefined):

```ts
// ---------------------------------------------------------------------------
// FollowUpEvaluator — the propose side of propose-then-dispose (ADR-0013). The bought LLM reads a
// take's transcript + light context and PROPOSES ranked tagged candidate threads. It decides
// NOTHING about the loop: our code (decideFollowUp in behavior.ts) applies the caps, the rapport
// gate, the distress short-circuit, the anti-repeat, and the emotional-door veto over these tags.
// Vendor SDKs live only in adapters — the architecture test scans this package and fails CI on any
// SDK import here. Phase 1 ships the mock (ScriptedFollowUpEvaluator); prod plugs Anthropic in.
// ---------------------------------------------------------------------------

import type { FollowUpCandidate } from "@chronicle/db";
export type { FollowUpCandidate };

export interface FollowUpEvaluationInput {
  /** Transcript of the take just recorded (the evaluator's primary input). */
  answerTranscript: string;
  /** The prompt this answer responded to (the Ask question, or the prior follow-up line). */
  promptText: string;
  /** Thread seeds already pursued this sitting — the model must propose only NOVEL threads. */
  alreadyAskedSeeds: ReadonlyArray<string>;
  /** Categories the narrator has already covered (novelty hint for the model). */
  coveredCategories: ReadonlyArray<string>;
  /** Follow-ups already asked in THIS thread (context only; code enforces the cap). */
  followUpsAskedInThread: number;
  /** True once the rapport threshold is met — a hint the model may weigh sensitivity against. */
  rapportEstablished: boolean;
}

export interface FollowUpEvaluation {
  /** Candidates (the model may rank; code re-ranks by confidence + tie-break authoritatively). */
  candidates: FollowUpCandidate[];
  /** Vendor model id, recorded in the decision record for replay/provenance. */
  modelId: string;
}

export interface FollowUpEvaluator {
  evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation>;
}
```

(Move the `import type` line to the top of `contracts.ts` with the other imports if the file's lint rule forbids mid-file imports — check the existing `verbatimModuleSyntax` style; the existing file imports at top, so hoist it.)

- [ ] **Step 5: Export from `index.ts`**

Add to `packages/interviewer/src/index.ts`:

```ts
export * from "./follow-up-policy";
export type {
  FollowUpEvaluationInput,
  FollowUpEvaluation,
  FollowUpEvaluator,
  FollowUpCandidate,
} from "./contracts";
```

- [ ] **Step 6: Write the resolver test**

Create `packages/interviewer/test/follow-up-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_UP_POLICY,
  resolveFollowUpPolicy,
} from "../src/follow-up-policy";

describe("resolveFollowUpPolicy", () => {
  it("returns the disabled-by-default policy with no overrides", () => {
    expect(resolveFollowUpPolicy()).toEqual(DEFAULT_FOLLOW_UP_POLICY);
    expect(resolveFollowUpPolicy().enabled).toBe(false);
  });

  it("applies partial overrides over the defaults", () => {
    const p = resolveFollowUpPolicy({ enabled: true, maxFollowUpsPerThread: 3 });
    expect(p.enabled).toBe(true);
    expect(p.maxFollowUpsPerThread).toBe(3);
    expect(p.confidenceThreshold).toBe(DEFAULT_FOLLOW_UP_POLICY.confidenceThreshold);
    expect(p.maxFollowUpsPerSession).toBe(DEFAULT_FOLLOW_UP_POLICY.maxFollowUpsPerSession);
  });

  it("does not mutate the shared default object", () => {
    resolveFollowUpPolicy({ enabled: true });
    expect(DEFAULT_FOLLOW_UP_POLICY.enabled).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests + typecheck (both packages)**

Run: `pnpm --filter @chronicle/db typecheck && pnpm --filter @chronicle/interviewer exec vitest run test/follow-up-policy.test.ts && pnpm --filter @chronicle/interviewer typecheck`
Expected: db typecheck clean; 3 tests passing; interviewer typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/follow-up-types.ts packages/db/src/index.ts packages/interviewer/src/follow-up-policy.ts packages/interviewer/src/contracts.ts packages/interviewer/src/index.ts packages/interviewer/test/follow-up-policy.test.ts
git commit -m "feat: follow-up shared contracts (persisted types in db, evaluator seam + policy in interviewer)"
```

---

## Task 1: Schema — `story_recordings` (ordered takes) + `follow_up_decisions` (append-only ledger)

Adds the two tables ADR-0012/0013 require, plus the append-only trigger and a post-consent delete guard. `story_recordings` holds per-take transcript **content**, so its table object is guarded behind `@chronicle/db/content` and reached only through `story-repository.ts` (Task 3b). `follow_up_decisions` holds only derived seeds/tags (operational tier per ADR-0013), so it lives in the open `@chronicle/db/schema` surface. Schema changes use the reseed workflow — **no incremental migration** (the `single-schema-no-migrations` convention).

**Files:**
- Modify: `packages/db/src/schema.ts` (add enums + two tables, near the other content/ledger tables ~line 458–532)
- Modify: `packages/db/src/content.ts` (export `storyRecordings`)
- Modify: `packages/db/src/schema-public.ts` (export `followUpDecisions` + its enums)
- Modify: `packages/db/src/index.ts` (re-export row types)
- Modify: `packages/db/drizzle/invariants.sql` (append-only + delete-guard triggers)
- Regenerate: `packages/db/drizzle/schema.sql` (via `db:generate`)
- Test: `packages/db/test/story-recordings.test.ts`

- [ ] **Step 1: Add the tables to `schema.ts`**

In `packages/db/src/schema.ts`, add these enums to the enum section (after `storyStateEnum`, ~line 60):

```ts
/** Two-kind ledger: a `decision` row (candidates + dispositions + phrased line) and an
 * `outcome` row (what the narrator did), the latter referencing the former. Mirrors the
 * consent ledger's append + superseding-append shape. */
export const followUpRecordKindEnum = pgEnum("follow_up_record_kind", ["decision", "outcome"]);

/** What the narrator did with an asked follow-up. */
export const followUpOutcomeEnum = pgEnum("follow_up_outcome", ["answered", "skipped", "off_ramped"]);
```

Then add both tables immediately after `consentRecords` (~line 532). Note the imported jsonb payload types come from `./follow-up-types` (Task 0):

```ts
import type {
  FollowUpCandidate,
  CandidateDisposition,
  FollowUpPolicy,
} from "./follow-up-types";

// ---------------------------------------------------------------------------
// StoryRecording — the ordered set of Takes for a voice Story (ADR-0012). A single-answer story
// has exactly one row (position 0, media = stories.recording_media_id). A follow-up thread adds
// rows in the order spoken. The canonical audio is this ORDERED SET; `stories.recording_media_id`
// is retained as the take-0 pointer (its immutability trigger + every existing read path keep
// working unchanged). Holds per-take transcript CONTENT, so the table object is guarded behind
// @chronicle/db/content and reached only via story-repository.ts.
// ---------------------------------------------------------------------------

export const storyRecordings = pgTable(
  "story_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    /** 0-based take order within the story. 0 = the initial answer; 1,2,… = follow-up takes. */
    position: integer("position").notNull(),
    /** The immutable Media (kind=story_audio) for THIS take. */
    mediaId: uuid("media_id")
      .notNull()
      .references(() => media.id),
    /** Raw ASR output for this take. Null until the transcribe step fills it. */
    transcript: text("transcript"),
    /** Word-level timing for this take (seam for sync playback), 1x time. */
    transcriptWordTimings: jsonb("transcript_word_timings").$type<
      Array<{ word: string; startMs: number; endMs: number }>
    >(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("story_recordings_story_idx").on(t.storyId),
    uniqueIndex("story_recordings_story_position_uq").on(t.storyId, t.position),
  ],
);

// ---------------------------------------------------------------------------
// FollowUpDecision — the append-only follow-up decision ledger (ADR-0013). Two row kinds:
//   `decision` — every candidate the evaluator proposed + its coded disposition + the phrased
//                line the narrator heard + the resolved policy snapshot (for replay/A-B).
//   `outcome`  — what the narrator did (answered/skipped/off_ramped), referencing the decision
//                it resolves. Written by the NEXT action, when the outcome is known.
// Nothing is discarded without a recorded reason — same discipline as the consent ledger.
// Stores only derived seeds/tags (title/summary tier), NOT transcript, so it is operational-tier
// (open schema), not behind the story front door.
// ---------------------------------------------------------------------------

export const followUpDecisions = pgTable(
  "follow_up_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Monotonic total order — deterministic "latest decision" even under same-timestamp rows. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    /** 0-based follow-up turn index within the thread (0 = evaluation after the initial answer). */
    threadPosition: integer("thread_position").notNull(),
    recordKind: followUpRecordKindEnum("record_kind").notNull(),
    // --- decision rows (null on outcome rows) ---
    evaluatorModelId: text("evaluator_model_id"),
    candidates: jsonb("candidates").$type<FollowUpCandidate[]>(),
    dispositions: jsonb("dispositions").$type<CandidateDisposition[]>(),
    /** The chosen threadSeed, or null when nothing was selected (thread ends). */
    selectedSeed: text("selected_seed"),
    /** The line the narrator actually heard, or null when nothing was selected. */
    phrasedLine: text("phrased_line"),
    /** Snapshot of the resolved policy that governed this turn (audit/replay). */
    policy: jsonb("policy").$type<FollowUpPolicy>(),
    // --- outcome rows (null on decision rows) ---
    /** Self-FK: the decision row this outcome resolves. Null on decision rows. */
    decisionId: uuid("decision_id"),
    outcome: followUpOutcomeEnum("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("follow_up_decisions_story_idx").on(t.storyId)],
);
```

(Hoist the `import type … from "./follow-up-types"` to the top of `schema.ts` with the other imports.)

- [ ] **Step 2: Wire the exports**

`packages/db/src/content.ts` — add `storyRecordings`:

```ts
export { media, stories, proseRevisions, storyRecordings } from "./schema";
```

`packages/db/src/schema-public.ts` — add `followUpDecisions` + its enums to the export list:

```ts
  followUpDecisions,
  // …existing…
  followUpRecordKindEnum,
  followUpOutcomeEnum,
```

`packages/db/src/index.ts` — add row-type re-exports next to the others:

```ts
  StoryRecording,
  NewStoryRecording,
  FollowUpDecisionRow,
  NewFollowUpDecisionRow,
```

…and export the inferred types from `schema.ts` (add near the bottom where `$inferSelect`/`$inferInsert` types are defined — follow the existing `Story`/`ProseRevision` pattern):

```ts
export type StoryRecording = typeof storyRecordings.$inferSelect;
export type NewStoryRecording = typeof storyRecordings.$inferInsert;
export type FollowUpDecisionRow = typeof followUpDecisions.$inferSelect;
export type NewFollowUpDecisionRow = typeof followUpDecisions.$inferInsert;
```

- [ ] **Step 3: Add the triggers to `invariants.sql`**

In `packages/db/drizzle/invariants.sql`, after the `prose_revisions_append_only` trigger (~line 31), add:

```sql
-- Follow-up decision ledger: append-only (ADR-0013). Reuses the shared guard. A follow-up
-- OUTCOME is a NEW row referencing its decision, never an edit of the decision row.
CREATE TRIGGER follow_up_decisions_append_only
  BEFORE UPDATE OR DELETE ON follow_up_decisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_mutation();
```

After the `stories_recording_pointer_immutable` trigger (~line 106), add the post-consent take guard:

```sql
-- Story takes are immutable AFTER approval (ADR-0012): a take may be dropped/re-recorded only
-- while the story has no consent records (pre-approval). Once the story is approved (a consent
-- row exists), the ordered take set is frozen — removable only by deleting the whole Story.
-- (UPDATE is left permitted so the transcribe step can backfill the derived transcript column;
-- the canonical AUDIO is protected by the media_immutable guard, not this one.)
CREATE OR REPLACE FUNCTION chronicle_story_recording_delete_guard()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM consent_records WHERE story_id = OLD.story_id) THEN
    RAISE EXCEPTION
      'Cannot delete story_recording %: its story has consent records; takes are immutable after approval.',
      OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER story_recordings_post_consent_immutable
  BEFORE DELETE ON story_recordings
  FOR EACH ROW EXECUTE FUNCTION chronicle_story_recording_delete_guard();
```

- [ ] **Step 4: Regenerate the DDL**

Run: `pnpm --filter @chronicle/db db:generate`
Expected: `packages/db/drizzle/schema.sql` now contains `CREATE TABLE story_recordings` and `CREATE TABLE follow_up_decisions` plus the two new enum types. (The triggers live only in `invariants.sql` — drizzle-kit doesn't emit them.)

- [ ] **Step 5: Write the regression test**

Create `packages/db/test/story-recordings.test.ts`. Use the PGlite helper the other db tests use (check `packages/db/test/*.test.ts` for the exact import — e.g. `createTestDb()` from `../src/testing`). The `stories`/`media`/`storyRecordings` table objects come from `@chronicle/db/content`; `followUpDecisions` + `consentRecords` from `@chronicle/db/schema`; you also need a `persons` row (FK). Model the setup on an existing db test (e.g. `packages/db/test/consent-ledger.test.ts`).

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "../src/testing";
import { media, stories, storyRecordings } from "../src/content";
import { followUpDecisions, consentRecords, persons } from "../src/schema";

// Minimal fixture: a person + a story + its take-0 media. Adjust helper names to match the
// existing db test suite's fixtures.
async function seedStory(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [p] = await db.insert(persons).values({ displayName: "Nonna", lifeStatus: "living" }).returning();
  const [m0] = await db.insert(media).values({
    ownerPersonId: p!.id, kind: "story_audio", storageKey: "k0", contentType: "audio/webm", checksum: "sha256:0",
  }).returning();
  const [s] = await db.insert(stories).values({
    ownerPersonId: p!.id, recordingMediaId: m0!.id,
  }).returning();
  return { person: p!, story: s!, media0: m0! };
}

describe("story_recordings", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => { ctx = await createTestDb(); });

  it("orders takes by position and enforces uniqueness per story", async () => {
    const { db } = ctx;
    const { story, media0, person } = await seedStory(db);
    const [m1] = await db.insert(media).values({
      ownerPersonId: person.id, kind: "story_audio", storageKey: "k1", contentType: "audio/webm", checksum: "sha256:1",
    }).returning();

    await db.insert(storyRecordings).values({ storyId: story.id, position: 0, mediaId: media0.id });
    await db.insert(storyRecordings).values({ storyId: story.id, position: 1, mediaId: m1!.id });

    const rows = await db.select().from(storyRecordings)
      .where(sql`${storyRecordings.storyId} = ${story.id}`)
      .orderBy(storyRecordings.position);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);

    // duplicate position rejected
    await expect(
      db.insert(storyRecordings).values({ storyId: story.id, position: 0, mediaId: m1!.id }),
    ).rejects.toThrow();
  });

  it("permits deleting a take pre-approval and forbids it once the story has consent", async () => {
    const { db } = ctx;
    const { story, media0, person } = await seedStory(db);
    const [m1] = await db.insert(media).values({
      ownerPersonId: person.id, kind: "story_audio", storageKey: "k1", contentType: "audio/webm", checksum: "sha256:1",
    }).returning();
    const [take1] = await db.insert(storyRecordings)
      .values({ storyId: story.id, position: 1, mediaId: m1!.id }).returning();

    // pre-approval: drop is allowed
    await db.delete(storyRecordings).where(sql`${storyRecordings.id} = ${take1!.id}`);

    // re-add, then record consent → drop now forbidden
    const [take1b] = await db.insert(storyRecordings)
      .values({ storyId: story.id, position: 1, mediaId: m1!.id }).returning();
    await db.insert(consentRecords).values({
      personId: person.id, storyId: story.id, action: "approved_for_sharing",
      resultingState: "shared", actorPersonId: person.id,
    });
    await expect(
      db.delete(storyRecordings).where(sql`${storyRecordings.id} = ${take1b!.id}`),
    ).rejects.toThrow(/immutable after approval/);
  });

  it("makes follow_up_decisions append-only (no UPDATE, no DELETE)", async () => {
    const { db } = ctx;
    const { story } = await seedStory(db);
    const [row] = await db.insert(followUpDecisions).values({
      storyId: story.id, threadPosition: 0, recordKind: "decision",
      selectedSeed: "the stained glass", phrasedLine: "Tell me about the stained glass.",
    }).returning();

    await expect(
      db.update(followUpDecisions).set({ selectedSeed: "changed" })
        .where(sql`${followUpDecisions.id} = ${row!.id}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.delete(followUpDecisions).where(sql`${followUpDecisions.id} = ${row!.id}`),
    ).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @chronicle/db exec vitest run test/story-recordings.test.ts`
Expected: 3 passing. (If the `consentRecords.action` enum value differs, match it to `consentActionEnum` in schema.ts — it is `approved_for_sharing` per the CLAUDE.md consent description.)

- [ ] **Step 7: Verify existing db + core tests still green + reseed dev DB**

Run: `pnpm --filter @chronicle/db test && pnpm --filter @chronicle/core test`
Expected: all green — the new tables are additive; no existing read path changed.
Reseed local dev (blows away + re-applies schema.sql + invariants.sql per the `single-schema-no-migrations` convention): trigger the web app's dev-seed path (`apps/web/lib/dev-seed.ts` → `resetSchema`). No data backfill needed (no users yet).

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/content.ts packages/db/src/schema-public.ts packages/db/src/index.ts packages/db/drizzle/invariants.sql packages/db/drizzle/schema.sql packages/db/test/story-recordings.test.ts
git commit -m "feat(db): story_recordings ordered takes + append-only follow_up_decisions ledger"
```

---

## Task 2: Evaluator mock (`ScriptedFollowUpEvaluator`)

Adds the deterministic mock so tests and dev exercise the loop without a paid vendor. Pure, dependency-free — same shape as `ScriptedVoice`.

**Files:**
- Modify: `packages/interviewer/src/mocks.ts`
- Modify: `packages/interviewer/src/index.ts` (export it)
- Test: covered by Task 3's decision tests (the mock is trivial; a dedicated test is optional)

- [ ] **Step 1: Add the mock**

Append to `packages/interviewer/src/mocks.ts` (extend the existing import block to include the new contract types):

```ts
import type {
  FollowUpEvaluator,
  FollowUpEvaluationInput,
  FollowUpEvaluation,
} from "./contracts";
import type { FollowUpCandidate } from "@chronicle/db";

/**
 * Deterministic evaluator mock. `script[n]` is the candidate list returned on the n-th `evaluate`
 * call, so a test can drive a multi-turn thread (turn 0 proposes, turn 1 proposes again, …).
 * Missing/exhausted entries return an empty candidate list (→ thread ends).
 */
export class ScriptedFollowUpEvaluator implements FollowUpEvaluator {
  readonly calls: FollowUpEvaluationInput[] = [];

  constructor(
    private readonly script: FollowUpCandidate[][] = [],
    private readonly modelId: string = "mock-follow-up-evaluator",
  ) {}

  async evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation> {
    const idx = this.calls.length;
    this.calls.push(input);
    return { candidates: this.script[idx] ?? [], modelId: this.modelId };
  }
}
```

- [ ] **Step 2: Export it**

Add `ScriptedFollowUpEvaluator` to the `mocks` re-export in `packages/interviewer/src/index.ts` (follow the existing `ScriptedVoice`/`InMemoryAskSource` export line).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @chronicle/interviewer typecheck`
Expected: clean.

```bash
git add packages/interviewer/src/mocks.ts packages/interviewer/src/index.ts
git commit -m "feat(interviewer): ScriptedFollowUpEvaluator mock"
```

---

## Task 3: `decideFollowUp` — the code gates (the heart of ADR-0013)

The deterministic picker. The evaluator only *proposes*; this function *disposes*: it applies the thread short-circuits (distress / thin-answer / caps), then per-candidate gates (anti-repeat, confidence floor, **emotional-door veto**, rapport gate), ranks the survivors authoritatively, and emits **a disposition for every candidate** so nothing is dropped without a recorded reason. Pure function — no I/O; the caller persists the returned dispositions into the ledger.

**Files:**
- Modify: `packages/interviewer/src/behavior.ts` (append the decision logic + types)
- Modify: `packages/interviewer/src/index.ts` (export `decideFollowUp` + its types)
- Test: `packages/interviewer/test/decide-follow-up.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/interviewer/test/decide-follow-up.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decideFollowUp, type FollowUpDecisionInput } from "../src/behavior";
import { resolveFollowUpPolicy } from "../src/follow-up-policy";
import type { FollowUpCandidate } from "@chronicle/db";

const cand = (over: Partial<FollowUpCandidate> = {}): FollowUpCandidate => ({
  threadSeed: "the stained glass window",
  type: "sensory",
  sensitivity: "low",
  confidence: 0.9,
  narratorOpened: false,
  ...over,
});

const base = (over: Partial<FollowUpDecisionInput> = {}): FollowUpDecisionInput => ({
  evaluation: { candidates: [cand()], modelId: "m" },
  policy: resolveFollowUpPolicy({ enabled: true }),
  answerWordCount: 40,
  followUpsAskedInThread: 0,
  followUpsAskedInSession: 0,
  distressed: false,
  offRampRequested: false,
  rapportEstablished: false,
  alreadyAskedSeeds: [],
  ...over,
});

describe("decideFollowUp", () => {
  it("selects the single confident candidate and records it as selected", () => {
    const d = decideFollowUp(base());
    expect(d.selected?.threadSeed).toBe("the stained glass window");
    expect(d.shortCircuit).toBeNull();
    expect(d.dispositions).toEqual([
      { candidate: cand(), reason: "selected", selected: true },
    ]);
  });

  it("short-circuits on distress, marking every candidate distress_shortcircuit", () => {
    const d = decideFollowUp(base({ distressed: true, evaluation: { candidates: [cand(), cand({ threadSeed: "x" })], modelId: "m" } }));
    expect(d.selected).toBeNull();
    expect(d.shortCircuit).toBe("distress_shortcircuit");
    expect(d.dispositions.map((x) => x.reason)).toEqual(["distress_shortcircuit", "distress_shortcircuit"]);
  });

  it("short-circuits on an off-ramp request", () => {
    expect(decideFollowUp(base({ offRampRequested: true })).shortCircuit).toBe("distress_shortcircuit");
  });

  it("short-circuits a thin answer below the word floor", () => {
    const d = decideFollowUp(base({ answerWordCount: 3 }));
    expect(d.shortCircuit).toBe("thin_answer");
    expect(d.selected).toBeNull();
  });

  it("short-circuits when the per-thread cap is reached", () => {
    const d = decideFollowUp(base({ followUpsAskedInThread: 2 }));
    expect(d.shortCircuit).toBe("over_cap_thread");
  });

  it("short-circuits when the per-session cap is reached", () => {
    const d = decideFollowUp(base({ followUpsAskedInSession: 4 }));
    expect(d.shortCircuit).toBe("over_cap_session");
  });

  it("vetoes an emotional candidate the narrator did not open (emotional-door rule)", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ type: "emotional", narratorOpened: false })], modelId: "m" } }));
    expect(d.selected).toBeNull();
    expect(d.dispositions[0]!.reason).toBe("emotional_door_closed");
  });

  it("allows an emotional candidate the narrator DID open", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ type: "emotional", narratorOpened: true })], modelId: "m" } }));
    expect(d.selected?.type).toBe("emotional");
  });

  it("gates a high-sensitivity candidate until rapport is established", () => {
    const hi = cand({ sensitivity: "high" });
    expect(decideFollowUp(base({ evaluation: { candidates: [hi], modelId: "m" }, rapportEstablished: false })).dispositions[0]!.reason).toBe("below_rapport");
    expect(decideFollowUp(base({ evaluation: { candidates: [hi], modelId: "m" }, rapportEstablished: true })).selected?.sensitivity).toBe("high");
  });

  it("drops a low-confidence candidate", () => {
    const d = decideFollowUp(base({ evaluation: { candidates: [cand({ confidence: 0.3 })], modelId: "m" } }));
    expect(d.dispositions[0]!.reason).toBe("below_confidence");
    expect(d.selected).toBeNull();
  });

  it("drops a candidate that repeats an already-asked seed (lexical anti-repeat)", () => {
    const d = decideFollowUp(base({ alreadyAskedSeeds: ["the STAINED glass window"] }));
    expect(d.dispositions[0]!.reason).toBe("duplicate");
    expect(d.selected).toBeNull();
  });

  it("ranks by confidence, marking the winner selected and the rest not_selected", () => {
    const lo = cand({ threadSeed: "lo", confidence: 0.7 });
    const hi = cand({ threadSeed: "hi", confidence: 0.95 });
    const d = decideFollowUp(base({ evaluation: { candidates: [lo, hi], modelId: "m" } }));
    expect(d.selected?.threadSeed).toBe("hi");
    const byReason = Object.fromEntries(d.dispositions.map((x) => [x.candidate.threadSeed, x.reason]));
    expect(byReason).toEqual({ hi: "selected", lo: "not_selected" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chronicle/interviewer exec vitest run test/decide-follow-up.test.ts`
Expected: FAIL — `decideFollowUp` not exported from behavior.ts.

- [ ] **Step 3: Implement `decideFollowUp`**

Append to `packages/interviewer/src/behavior.ts`:

```ts
import type { FollowUpEvaluation, FollowUpCandidate } from "./contracts";
import type {
  CandidateDisposition,
  FollowUpDispositionReason,
  FollowUpPolicy,
  FollowUpType,
} from "@chronicle/db";

// ---------------------------------------------------------------------------
// decideFollowUp — the DISPOSE half of propose-then-dispose (ADR-0013). The evaluator proposed
// candidates + tags; this pure function applies the code-owned gates and picks at most one,
// emitting a disposition for EVERY candidate (nothing dropped without a recorded reason). The
// caller (recordAnswerAction's mini-loop) persists the returned dispositions into the ledger.
// ---------------------------------------------------------------------------

export interface FollowUpDecisionInput {
  evaluation: FollowUpEvaluation;
  policy: FollowUpPolicy;
  /** Word count of the answer that was evaluated (thin-answer gate). */
  answerWordCount: number;
  followUpsAskedInThread: number;
  followUpsAskedInSession: number;
  distressed: boolean;
  offRampRequested: boolean;
  rapportEstablished: boolean;
  /** Seeds already asked this sitting — the cheap lexical anti-repeat backstop. */
  alreadyAskedSeeds: ReadonlyArray<string>;
}

/** A thread-level veto that applies before any per-candidate ranking. */
export type FollowUpShortCircuit = Extract<
  FollowUpDispositionReason,
  "thin_answer" | "distress_shortcircuit" | "over_cap_thread" | "over_cap_session"
>;

export interface FollowUpDecision {
  /** The chosen candidate to phrase, or null → the thread ends. */
  selected: FollowUpCandidate | null;
  /** Every candidate + its coded disposition — the audit payload. */
  dispositions: CandidateDisposition[];
  /** A thread-level short-circuit reason, or null if the veto (if any) was per-candidate. */
  shortCircuit: FollowUpShortCircuit | null;
}

/** Tie-break preference among equal-confidence candidates. Emotional is least-preferred (caution). */
const TYPE_PRIORITY: Record<FollowUpType, number> = {
  factual: 0,
  sensory: 1,
  temporal: 2,
  relational: 3,
  emotional: 4,
};

export function decideFollowUp(input: FollowUpDecisionInput): FollowUpDecision {
  const candidates = input.evaluation.candidates;

  // (1) Thread-level short-circuits. Distress/off-ramp first (safety), then thin-answer, then the
  // hard caps. Every candidate is marked with the short-circuit reason — nothing silent.
  const sc = threadShortCircuit(input);
  if (sc) {
    return {
      selected: null,
      shortCircuit: sc,
      dispositions: candidates.map((c) => ({ candidate: c, reason: sc, selected: false })),
    };
  }

  // (2) Per-candidate eligibility. First failing gate wins (deterministic precedence below).
  const dispositions: CandidateDisposition[] = [];
  const eligible: FollowUpCandidate[] = [];
  for (const c of candidates) {
    const reason = ineligibilityReason(c, input);
    if (reason) dispositions.push({ candidate: c, reason, selected: false });
    else eligible.push(c);
  }

  if (eligible.length === 0) {
    return { selected: null, shortCircuit: null, dispositions };
  }

  // (3) Authoritative rank: confidence desc, tie-break by type priority then seed. The model's
  // ordering is advisory; code owns the final choice.
  const winner = [...eligible].sort(compareCandidates)[0]!;
  for (const c of eligible) {
    dispositions.push({
      candidate: c,
      reason: c === winner ? "selected" : "not_selected",
      selected: c === winner,
    });
  }
  return { selected: winner, shortCircuit: null, dispositions };
}

function threadShortCircuit(input: FollowUpDecisionInput): FollowUpShortCircuit | null {
  if (input.distressed || input.offRampRequested) return "distress_shortcircuit";
  if (input.answerWordCount < input.policy.thinAnswerWordFloor) return "thin_answer";
  if (input.followUpsAskedInThread >= input.policy.maxFollowUpsPerThread) return "over_cap_thread";
  if (input.followUpsAskedInSession >= input.policy.maxFollowUpsPerSession) return "over_cap_session";
  return null;
}

/**
 * Per-candidate veto precedence (first match recorded): duplicate (already covered — most
 * definitive) → emotional-door (hard safety veto) → rapport gate (safety) → confidence floor
 * (quality). Returns null when the candidate is eligible.
 */
function ineligibilityReason(
  c: FollowUpCandidate,
  input: FollowUpDecisionInput,
): FollowUpDispositionReason | null {
  if (isDuplicate(c.threadSeed, input.alreadyAskedSeeds)) return "duplicate";
  if (c.type === "emotional" && !c.narratorOpened) return "emotional_door_closed";
  if (c.sensitivity === "high" && !input.rapportEstablished) return "below_rapport";
  if (c.confidence < input.policy.confidenceThreshold) return "below_confidence";
  return null;
}

function compareCandidates(a: FollowUpCandidate, b: FollowUpCandidate): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (TYPE_PRIORITY[a.type] !== TYPE_PRIORITY[b.type]) return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
  return a.threadSeed.localeCompare(b.threadSeed);
}

function normSeed(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function isDuplicate(seed: string, priors: ReadonlyArray<string>): boolean {
  const n = normSeed(seed);
  if (!n) return false;
  return priors.some((p) => {
    const q = normSeed(p);
    return q === n || q.includes(n) || n.includes(q);
  });
}
```

- [ ] **Step 4: Export from `index.ts`**

Add to `packages/interviewer/src/index.ts`:

```ts
export {
  decideFollowUp,
  type FollowUpDecisionInput,
  type FollowUpDecision,
  type FollowUpShortCircuit,
} from "./behavior";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @chronicle/interviewer exec vitest run test/decide-follow-up.test.ts && pnpm --filter @chronicle/interviewer typecheck && pnpm --filter @chronicle/interviewer test`
Expected: the 13 decision tests pass; typecheck clean; the whole interviewer suite (including the old `follow_up` picker tests, which are untouched) green.

- [ ] **Step 6: Commit**

```bash
git add packages/interviewer/src/behavior.ts packages/interviewer/src/index.ts packages/interviewer/test/decide-follow-up.test.ts
git commit -m "feat(interviewer): decideFollowUp code gates (caps, emotional-door veto, rank + full dispositions)"
```

---

## Task 4: Core repositories — `story_recordings` (audited) + `follow_up_decisions` (ledger)

Two repos. `story_recordings` functions go in `story-repository.ts` (already in the architecture-test allowlist; imports guarded `@chronicle/db/content`). The follow-up ledger goes in a new `follow-up-record.ts` (operational tier — imports the open `@chronicle/db/schema`, needs no allowlist entry). Take 0 is now written into `story_recordings` at draft creation so the data model is consistent even on the flag-off path.

**Files:**
- Modify: `packages/core/src/story-repository.ts`
- Create: `packages/core/src/follow-up-record.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/story-recordings-repo.test.ts`, `packages/core/test/follow-up-record.test.ts`

- [ ] **Step 1: Write take 0 into `story_recordings` at draft creation**

In `persistRecordingAndCreateDraft` (`story-repository.ts:76`), inside the existing `db.transaction`, after the `stories` row is inserted (`story.id` known), add — using the same `tx`:

```ts
    // Seed the ordered take set with take 0 (the initial answer). The multi-take model (ADR-0012)
    // treats the canonical audio as this ordered set; recording_media_id stays the take-0 pointer.
    // Written unconditionally (even flag-off) so the data model is consistent everywhere.
    await tx.insert(storyRecordings).values({
      storyId: story.id,
      position: 0,
      mediaId: rec.id,
    });
```

Add `storyRecordings` to the `@chronicle/db/content` import at the top of `story-repository.ts`.

- [ ] **Step 2: Add the take repo functions to `story-repository.ts`**

```ts
/** Ordered takes for a story (position asc), including per-take transcript. Audited read. */
export async function listStoryRecordings(db: Database, storyId: string): Promise<StoryRecording[]> {
  return db
    .select()
    .from(storyRecordings)
    .where(eq(storyRecordings.storyId, storyId))
    .orderBy(storyRecordings.position);
}

/** Append a follow-up take at the next position. Media must already be persisted (immutable). */
export async function appendStoryRecording(
  db: Database,
  input: { storyId: string; mediaId: string },
): Promise<StoryRecording> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ position: storyRecordings.position })
      .from(storyRecordings)
      .where(eq(storyRecordings.storyId, input.storyId))
      .orderBy(desc(storyRecordings.position))
      .limit(1);
    const nextPosition = (existing[0]?.position ?? -1) + 1;
    const [row] = await tx
      .insert(storyRecordings)
      .values({ storyId: input.storyId, position: nextPosition, mediaId: input.mediaId })
      .returning();
    return row!;
  });
}

/** Pipeline read: the storage key + owner context for ONE take. System-actor (no viewer authz). */
export async function getStoryRecordingForPipeline(
  db: Database,
  storyRecordingId: string,
): Promise<{ storyId: string; storageKey: string; contentType: string } | null> {
  const [row] = await db
    .select({
      storyId: storyRecordings.storyId,
      storageKey: media.storageKey,
      contentType: media.contentType,
    })
    .from(storyRecordings)
    .innerJoin(media, eq(media.id, storyRecordings.mediaId))
    .where(eq(storyRecordings.id, storyRecordingId))
    .limit(1);
  return row ?? null;
}

/** Backfill a take's derived transcript (from the transcribe step). */
export async function updateStoryRecordingTranscript(
  db: Database,
  input: {
    storyRecordingId: string;
    transcript: string;
    transcriptWordTimings?: Array<{ word: string; startMs: number; endMs: number }>;
  },
): Promise<void> {
  await db
    .update(storyRecordings)
    .set({
      transcript: input.transcript,
      ...(input.transcriptWordTimings ? { transcriptWordTimings: input.transcriptWordTimings } : {}),
    })
    .where(eq(storyRecordings.id, input.storyRecordingId));
}

/**
 * Drop a FOLLOW-UP take (position > 0) pre-approval, and return its storage key for blob cleanup.
 * Guards: owner-only, story not yet consented (state draft/pending_approval), position != 0
 * (dropping the initial take is the whole-thread discard — use discardDraftStory instead). The
 * DB delete-guard trigger is the backstop; this is the friendly application-level check.
 */
export async function dropStoryRecording(
  db: Database,
  input: { storyId: string; position: number; narratorPersonId: string },
): Promise<{ storageKey: string }> {
  if (input.position === 0) {
    throw new InvariantViolation("Cannot drop take 0 — dropping the initial take discards the thread.");
  }
  return db.transaction(async (tx) => {
    const [story] = await tx
      .select({ ownerPersonId: stories.ownerPersonId, state: stories.state })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1);
    if (!story) throw new InvariantViolation("Story not found.");
    if (story.ownerPersonId !== input.narratorPersonId) throw new InvariantViolation("Not the owner.");
    if (story.state !== "draft" && story.state !== "pending_approval") {
      throw new InvariantViolation("Takes are immutable after approval.");
    }
    const [take] = await tx
      .select({ id: storyRecordings.id, mediaId: storyRecordings.mediaId })
      .from(storyRecordings)
      .where(and(eq(storyRecordings.storyId, input.storyId), eq(storyRecordings.position, input.position)))
      .limit(1);
    if (!take) throw new InvariantViolation("Take not found.");
    const [m] = await tx.select({ storageKey: media.storageKey }).from(media).where(eq(media.id, take.mediaId)).limit(1);
    // story_recordings first (FK), then the never-consented media row.
    await tx.delete(storyRecordings).where(eq(storyRecordings.id, take.id));
    await tx.delete(media).where(eq(media.id, take.mediaId));
    return { storageKey: m!.storageKey };
  });
}
```

(Import `desc`, `and` from `drizzle-orm`, `StoryRecording` from `@chronicle/db`, and reuse the existing `InvariantViolation` class already used in this file.)

- [ ] **Step 3: Write the follow-up ledger repo**

Create `packages/core/src/follow-up-record.ts`:

```ts
/**
 * Append-only follow-up decision ledger (ADR-0013). Operational tier — stores only derived seeds
 * and tags, never transcript, so it lives outside the story front door (open @chronicle/db/schema).
 * Two row kinds: `decision` (written at decision time) and `outcome` (written by the NEXT action,
 * referencing the decision it resolves). Never updated or deleted (DB trigger enforces).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { followUpDecisions } from "@chronicle/db/schema";
import type {
  Database,
  FollowUpCandidate,
  CandidateDisposition,
  FollowUpOutcome,
  FollowUpPolicy,
  FollowUpDecisionRow,
} from "@chronicle/db";

export async function appendFollowUpDecision(
  db: Database,
  input: {
    storyId: string;
    threadPosition: number;
    evaluatorModelId: string;
    candidates: FollowUpCandidate[];
    dispositions: CandidateDisposition[];
    selectedSeed: string | null;
    phrasedLine: string | null;
    policy: FollowUpPolicy;
  },
): Promise<{ decisionId: string }> {
  const [row] = await db
    .insert(followUpDecisions)
    .values({
      storyId: input.storyId,
      threadPosition: input.threadPosition,
      recordKind: "decision",
      evaluatorModelId: input.evaluatorModelId,
      candidates: input.candidates,
      dispositions: input.dispositions,
      selectedSeed: input.selectedSeed,
      phrasedLine: input.phrasedLine,
      policy: input.policy,
    })
    .returning({ id: followUpDecisions.id });
  return { decisionId: row!.id };
}

export async function appendFollowUpOutcome(
  db: Database,
  input: { storyId: string; decisionId: string; threadPosition: number; outcome: FollowUpOutcome },
): Promise<void> {
  await db.insert(followUpDecisions).values({
    storyId: input.storyId,
    threadPosition: input.threadPosition,
    recordKind: "outcome",
    decisionId: input.decisionId,
    outcome: input.outcome,
  });
}

/**
 * The latest `decision` row for a story that has NO `outcome` row referencing it — i.e. the
 * follow-up the narrator is currently responding to. The next action attaches its outcome here.
 * Returns null when every decision already has an outcome (or none exist).
 */
export async function latestUnresolvedDecision(
  db: Database,
  storyId: string,
): Promise<FollowUpDecisionRow | null> {
  const [row] = await db
    .select()
    .from(followUpDecisions)
    .where(
      and(
        eq(followUpDecisions.storyId, storyId),
        eq(followUpDecisions.recordKind, "decision"),
        sql`not exists (
          select 1 from ${followUpDecisions} o
          where o.record_kind = 'outcome' and o.decision_id = ${followUpDecisions.id}
        )`,
      ),
    )
    .orderBy(desc(followUpDecisions.seq))
    .limit(1);
  return row ?? null;
}

/** Full audit read for a story, in ledger order. */
export async function listFollowUpDecisionsForStory(
  db: Database,
  storyId: string,
): Promise<FollowUpDecisionRow[]> {
  return db
    .select()
    .from(followUpDecisions)
    .where(eq(followUpDecisions.storyId, storyId))
    .orderBy(followUpDecisions.seq);
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`**

```ts
export {
  listStoryRecordings,
  appendStoryRecording,
  getStoryRecordingForPipeline,
  updateStoryRecordingTranscript,
  dropStoryRecording,
} from "./story-repository";
export * from "./follow-up-record";
```

- [ ] **Step 5: Write regression tests**

Create `packages/core/test/follow-up-record.test.ts` (PGlite; model DB setup on an existing core test). Cover: append decision → `latestUnresolvedDecision` returns it → append outcome → `latestUnresolvedDecision` returns null; and that a second decision after an outcome is the new unresolved one.

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@chronicle/db/testing";
import {
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
} from "../src/follow-up-record";
import { resolveFollowUpPolicy } from "@chronicle/interviewer";
// seed a person + story via the same fixture helper the other core tests use

describe("follow-up ledger", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>;
  let storyId: string;
  beforeEach(async () => {
    ctx = await createTestDb();
    storyId = /* create a draft story via the test fixture */ "";
  });

  it("tracks the unresolved decision until an outcome is appended", async () => {
    const { db } = ctx;
    const { decisionId } = await appendFollowUpDecision(db, {
      storyId, threadPosition: 0, evaluatorModelId: "m",
      candidates: [], dispositions: [], selectedSeed: "seed", phrasedLine: "line?",
      policy: resolveFollowUpPolicy({ enabled: true }),
    });
    expect((await latestUnresolvedDecision(db, storyId))?.id).toBe(decisionId);

    await appendFollowUpOutcome(db, { storyId, decisionId, threadPosition: 0, outcome: "answered" });
    expect(await latestUnresolvedDecision(db, storyId)).toBeNull();

    const all = await listFollowUpDecisionsForStory(db, storyId);
    expect(all.map((r) => r.recordKind)).toEqual(["decision", "outcome"]);
  });
});
```

Create `packages/core/test/story-recordings-repo.test.ts`: assert `persistRecordingAndCreateDraft` seeds take 0 at position 0; `appendStoryRecording` appends at position 1; `dropStoryRecording` rejects position 0 and removes a follow-up take pre-approval.

- [ ] **Step 6: Run + verify no architecture-test regression**

Run: `pnpm --filter @chronicle/core test`
Expected: new tests pass; **`architecture.test.ts` still passes** (follow-up-record.ts imports only the open `@chronicle/db/schema`, never `/content`; story_recordings access stays inside the allowlisted story-repository.ts).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/story-repository.ts packages/core/src/follow-up-record.ts packages/core/src/index.ts packages/core/test/follow-up-record.test.ts packages/core/test/story-recordings-repo.test.ts
git commit -m "feat(core): audited story_recordings repo + append-only follow-up ledger"
```

---

## Task 5: Pipeline — per-take transcribe + stitch-then-polish-once

ADR-0012: each take is transcribed as recorded (it is the evaluator's input); the expensive prose polish runs **once** over the stitched transcript at thread completion. New file so `orchestrator.ts` stays focused; reuses `renderStoryFromTranscript` and the existing working-copy/word-timing logic. The existing two-stage flow (`dispatchPipeline`) is **untouched** — it stays the flag-off / thread-of-one path.

**Files:**
- Create: `packages/pipeline/src/multi-take.ts`
- Modify: `packages/pipeline/src/index.ts` (export the two functions)
- Modify: `packages/pipeline/src/orchestrator.ts` (extract the word-timing map helper for reuse, if inline)
- Test: `packages/pipeline/test/stitch-render.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/pipeline/test/stitch-render.test.ts`. Use the existing pipeline test mocks (`ScriptedTranscriber`, a scripted `LanguageModel`, in-memory storage — copy the setup from `packages/pipeline/test/pipeline.test.ts`). Seed a story with two takes (via core's `appendStoryRecording` + storage `put`), then:

```ts
it("transcribes each take, stitches in order, and polishes once → pending_approval", async () => {
  // deps: db + in-memory storage + ScriptedTranscriber that returns per-key text + scripted LLM
  await transcribeTakeToRecording(deps, take0Id);
  await transcribeTakeToRecording(deps, take1Id);
  await stitchAndRenderStory(deps, storyId);

  const takes = await listStoryRecordings(deps.db, storyId);
  expect(takes.map((t) => t.transcript)).toEqual(["take zero words", "take one words"]);

  const story = await getStoryForViewer(deps.db, ownerCtx, storyId);
  expect(story!.transcript).toBe("take zero words\n\ntake one words");
  expect(story!.state).toBe("pending_approval");
  expect(story!.prose).toBeTruthy();
  expect(scriptedLlm.completeCalls).toHaveLength(1); // polish runs ONCE, not per take
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/stitch-render.test.ts`
Expected: FAIL — `transcribeTakeToRecording`/`stitchAndRenderStory` not exported.

- [ ] **Step 3: Implement `multi-take.ts`**

Create `packages/pipeline/src/multi-take.ts`:

```ts
/**
 * Multi-take pipeline (ADR-0012). Two operations the follow-up thread needs, distinct from the
 * one-shot two-stage orchestrator (which stays the flag-off / thread-of-one path):
 *   - transcribeTakeToRecording: transcribe ONE take as recorded (the evaluator's input), storing
 *     the derived transcript on its story_recordings row.
 *   - stitchAndRenderStory: at thread completion, concatenate the take transcripts in order and
 *     run the EXPENSIVE prose polish exactly ONCE over the stitched whole → pending_approval.
 * Both call @chronicle/core (never the guarded tables directly), keeping the pipeline out of the
 * content front door.
 */
import {
  getStoryRecordingForPipeline,
  updateStoryRecordingTranscript,
  listStoryRecordings,
  updateDerivedFields,
  transitionStoryState,
  appendProseRevision,
  getStoryAndRecordingForPipeline,
} from "@chronicle/core";
import { renderStoryFromTranscript } from "./render-story";
import { mapWordTimingsToRealTime } from "./orchestrator"; // extract + export in Step 4 if inline
import type { PipelineDeps } from "./orchestrator";

export async function transcribeTakeToRecording(
  deps: Pick<PipelineDeps, "db" | "storage" | "transcriber" | "workingCopyTransformer">,
  storyRecordingId: string,
): Promise<{ transcript: string }> {
  const take = await getStoryRecordingForPipeline(deps.db, storyRecordingId);
  if (!take) throw new Error(`story_recording ${storyRecordingId} not found`);

  const bytes = await deps.storage.getBytes(take.storageKey);
  const transformer = deps.workingCopyTransformer;
  const working = await transformer.transform({ bytes, contentType: take.contentType });
  const result = await deps.transcriber.transcribe({
    bytes: working.bytes,
    contentType: working.contentType,
  });
  const timings = mapWordTimingsToRealTime(result.words, working.speedFactor);
  await updateStoryRecordingTranscript(deps.db, {
    storyRecordingId,
    transcript: result.text,
    transcriptWordTimings: timings,
  });
  return { transcript: result.text };
}

export async function stitchAndRenderStory(
  deps: Pick<PipelineDeps, "db" | "languageModel">,
  storyId: string,
): Promise<void> {
  const takes = await listStoryRecordings(deps.db, storyId);
  const stitched = takes
    .map((t) => t.transcript?.trim())
    .filter((s): s is string => Boolean(s))
    .join("\n\n");

  // L1 provenance: the stitched raw transcript.
  await updateDerivedFields(deps.db, storyId, { transcript: stitched });
  await appendProseRevision(deps.db, { storyId, level: "ai_transcribed", text: stitched });

  // Single polish over the whole thread.
  const view = await getStoryAndRecordingForPipeline(deps.db, storyId);
  const render = await renderStoryFromTranscript(deps.languageModel, {
    transcript: stitched,
    promptQuestion: view?.promptQuestion ?? null,
    ownerSpokenName: view?.ownerSpokenName ?? null,
    ownerBirthYear: view?.ownerBirthYear ?? null,
  });
  await updateDerivedFields(deps.db, storyId, {
    prose: render.prose,
    title: render.title,
    summary: render.summary,
    tags: render.tags,
  });
  await appendProseRevision(deps.db, {
    storyId,
    level: "ai_polished",
    text: render.prose,
    modelId: render.modelId,
    promptText: render.systemPrompt,
  });
  await transitionStoryState(deps.db, storyId, "pending_approval");
}
```

If `mapWordTimingsToRealTime` is currently inline in `orchestrator.ts`'s transcribe stage (`orchestrator.ts:162-166`), extract it to a named exported function there and call it from both places (DRY). Match the exact signature the render stage expects (`renderStoryFromTranscript`'s input) — verify against `render-story.ts:70-81` (`buildMessages` reads `promptQuestion`/`ownerSpokenName`/`ownerBirthYear`).

- [ ] **Step 4: Export**

Add to `packages/pipeline/src/index.ts`:

```ts
export { transcribeTakeToRecording, stitchAndRenderStory } from "./multi-take";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @chronicle/pipeline exec vitest run test/stitch-render.test.ts && pnpm --filter @chronicle/pipeline typecheck && pnpm --filter @chronicle/pipeline test`
Expected: new test green; the pipeline architecture test (no vendor SDK imports) still green; full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/pipeline/src/multi-take.ts packages/pipeline/src/index.ts packages/pipeline/src/orchestrator.ts packages/pipeline/test/stitch-render.test.ts
git commit -m "feat(pipeline): per-take transcribe + stitch-then-polish-once for multi-take stories"
```

---

## Task 6: Web — policy resolver, LLM evaluator, and the `recordAnswerAction` mini-loop

The orchestration. When the policy flag is OFF, `recordAnswerAction` is byte-for-byte today's one-shot path. When ON, it becomes a mini-loop: transcribe take → evaluate → decide → (phrase a follow-up **or** stitch+render → review). The evaluator rides the existing `LanguageModel` seam (like `phraser.ts`), so **no new vendor adapter** and no architecture-test change. An explicit latency budget wraps the evaluate+phrase round-trips; on timeout or any failure the loop **degrades to one-shot** (renders and sends the narrator to review) — a broken evaluator can never block sharing (handoff watch #2).

**Files:**
- Create: `packages/interviewer/src/follow-up-evaluator.ts` (LLM-backed `FollowUpEvaluator`, prompt-as-data)
- Modify: `packages/interviewer/src/index.ts` (export `createLlmFollowUpEvaluator`)
- Create: `apps/web/lib/follow-up-config.ts` (resolve the policy from env; the subscription seam)
- Modify: `apps/web/lib/runtime.ts` (provide `followUpEvaluator` on the runtime)
- Modify: `apps/web/app/hub/answer/[askId]/actions.ts` (mini-loop + new actions)
- Test: `packages/interviewer/test/follow-up-evaluator.test.ts` (parse robustness)

- [ ] **Step 1: LLM-backed evaluator (prompt-as-data)**

Create `packages/interviewer/src/follow-up-evaluator.ts`:

```ts
/**
 * LLM-backed FollowUpEvaluator. Rides the existing LanguageModel seam (the same one phraser.ts
 * uses) — so it is NOT a vendor adapter and the architecture test permits it here. The model only
 * PROPOSES tagged candidates; decideFollowUp (behavior.ts) disposes. The system prompt is versioned
 * human text (prompts-as-data): the OUTPUT CONTRACT is fixed in code (the JSON shape + our enums);
 * the WORDING is meant to be swappable without a redeploy in a later prompt store.
 */
import type { LanguageModel } from "@chronicle/pipeline";
import type { FollowUpCandidate, FollowUpType, FollowUpSensitivity } from "@chronicle/db";
import type { FollowUpEvaluator, FollowUpEvaluationInput, FollowUpEvaluation } from "./contracts";

const SYSTEM_PROMPT = `You help a warm family interviewer decide whether a narrator's answer contains
a thread worth gently deepening with ONE short follow-up question. You do NOT ask anything and you
do NOT decide the flow — you only propose candidate threads; separate code chooses and gates them.

Read the narrator's answer and the question it responded to. Propose AT MOST 3 candidate threads that
are (a) genuinely present in what they said, (b) NOVEL (not already covered — you are told what is),
and (c) worth deepening for a family memory. For each candidate output:
- threadSeed: a short (<=8 word) paraphrase of the thread (NOT a full question).
- type: one of factual | sensory | temporal | relational | emotional.
- sensitivity: low | medium | high (how tender the topic is).
- confidence: 0..1, how sure you are it is worth asking.
- narratorOpened: true ONLY if the narrator's OWN words already surfaced this feeling/topic. For any
  emotional thread, set this truthfully — a closed emotional door will be vetoed downstream.

Never invent content the narrator did not say. If nothing is worth deepening, return an empty list.
Output STRICT JSON: {"candidates":[{"threadSeed":"...","type":"...","sensitivity":"...","confidence":0.0,"narratorOpened":false}]}`;

const TYPES: ReadonlySet<string> = new Set(["factual", "sensory", "temporal", "relational", "emotional"]);
const SENS: ReadonlySet<string> = new Set(["low", "medium", "high"]);

export function createLlmFollowUpEvaluator(llm: LanguageModel): FollowUpEvaluator {
  return {
    async evaluate(input: FollowUpEvaluationInput): Promise<FollowUpEvaluation> {
      const user = [
        `QUESTION THEY ANSWERED:\n${input.promptText}`,
        `THEIR ANSWER (transcript):\n${input.answerTranscript}`,
        input.alreadyAskedSeeds.length
          ? `ALREADY ASKED THIS SITTING (do not repeat):\n- ${input.alreadyAskedSeeds.join("\n- ")}`
          : "",
        input.coveredCategories.length
          ? `ALREADY COVERED CATEGORIES:\n${input.coveredCategories.join(", ")}`
          : "",
      ].filter(Boolean).join("\n\n");

      const res = await llm.complete({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
        responseFormat: "json",
        temperature: 0.3,
        maxOutputTokens: 500,
      });
      return { candidates: parseCandidates(res.text), modelId: res.modelId };
    },
  };
}

/** Defensive parse: tolerate fenced/raw JSON, drop malformed candidates, clamp confidence. */
export function parseCandidates(text: string): FollowUpCandidate[] {
  const jsonStr = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  const raw = (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(raw)) return [];
  const out: FollowUpCandidate[] = [];
  for (const c of raw) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    if (typeof o.threadSeed !== "string" || !o.threadSeed.trim()) continue;
    if (typeof o.type !== "string" || !TYPES.has(o.type)) continue;
    if (typeof o.sensitivity !== "string" || !SENS.has(o.sensitivity)) continue;
    const confidence = typeof o.confidence === "number" ? Math.max(0, Math.min(1, o.confidence)) : 0;
    out.push({
      threadSeed: o.threadSeed.trim(),
      type: o.type as FollowUpType,
      sensitivity: o.sensitivity as FollowUpSensitivity,
      confidence,
      narratorOpened: o.narratorOpened === true,
    });
  }
  return out;
}
```

Export `createLlmFollowUpEvaluator` (and `parseCandidates` for the test) from `packages/interviewer/src/index.ts`. Write `packages/interviewer/test/follow-up-evaluator.test.ts` asserting `parseCandidates` handles fenced JSON, drops entries with bad enums/missing seed, clamps confidence to [0,1], and returns `[]` on non-JSON.

- [ ] **Step 2: The policy resolver (subscription seam)**

Create `apps/web/lib/follow-up-config.ts`:

```ts
/**
 * Resolve the FollowUpPolicy for a request. v1: a single env flag (mirrors isXConfigured()); the
 * ONE place a subscription tier will later inject Partial<FollowUpPolicy> overrides. Off by default
 * so the feature lands dark.
 */
import { resolveFollowUpPolicy, type FollowUpPolicy } from "@chronicle/interviewer";

export function resolveFollowUpPolicyForRequest(): FollowUpPolicy {
  const enabled = process.env.FOLLOW_UPS_ENABLED === "1" || process.env.FOLLOW_UPS_ENABLED === "true";
  return resolveFollowUpPolicy({ enabled });
}
```

- [ ] **Step 3: Provide the evaluator on the runtime**

In `apps/web/lib/runtime.ts`, alongside the existing `languageModel` wiring (~line 259-300), add a `followUpEvaluator` built from the same `languageModel` (mock LLM in dev/CI → mock evaluator behavior automatically; real Anthropic when keyed):

```ts
import { createLlmFollowUpEvaluator } from "@chronicle/interviewer";
// … after languageModel is constructed:
const followUpEvaluator = createLlmFollowUpEvaluator(languageModel);
// add `followUpEvaluator` to the returned runtime object + its type.
```

- [ ] **Step 4: Rewrite `recordAnswerAction` as the mini-loop + add the new actions**

In `apps/web/app/hub/answer/[askId]/actions.ts`. Keep all existing auth/validation/`ingestRecording` logic in `recordAnswerAction` unchanged up to the point the draft `storyId` exists. Then branch on the policy. Add the shared result type and the three new actions. New imports:

```ts
import {
  decideFollowUp,
  phraseIntent,
  createCoreAnchorSource,
  createCoreMemorySource,
} from "@chronicle/interviewer";
import { detectDistress, detectOffRamp } from "@chronicle/interviewer";
import { transcribeTakeToRecording, stitchAndRenderStory } from "@chronicle/pipeline";
import {
  listStoryRecordings,
  appendStoryRecording,
  dropStoryRecording,
  discardDraftStory,
  appendFollowUpDecision,
  appendFollowUpOutcome,
  latestUnresolvedDecision,
  listFollowUpDecisionsForStory,
} from "@chronicle/core";
import { resolveFollowUpPolicyForRequest } from "@/lib/follow-up-config";
```

The shared result the client drives on:

```ts
export type ThreadStep =
  | { kind: "follow_up"; storyId: string; prompt: string }
  | { kind: "ready"; storyId: string }
  | { kind: "discarded" }
  | { error: string };

/** Latency budget for the follow-up tax (evaluate + phrase). Exceed → degrade to one-shot. The
 *  narrator's take is already transcribed regardless; this bounds only the extra follow-up work. */
const FOLLOW_UP_BUDGET_MS = 8000;
/** The Ask-answer surface has no live turn history → no rapport signal yet; stay conservative so
 *  high-sensitivity threads don't fire on this surface in v1 (the emotional-door veto is separate). */
const RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE = false;
```

The core helper — evaluate → decide → (phrase+persist follow-up | persist "none" + stitch/render). It is the ONLY place the ledger's `decision` rows are written; the caller writes the `outcome` rows:

```ts
async function runFollowUpStep(
  rt: Awaited<ReturnType<typeof getRuntime>>,
  args: { storyId: string; ownerPersonId: string; promptText: string; answerTranscript: string },
): Promise<ThreadStep> {
  const { db, languageModel, followUpEvaluator } = rt;
  const policy = resolveFollowUpPolicyForRequest();

  // Counters + anti-repeat, from the ledger (decision rows with a selected seed = follow-ups asked).
  const priorDecisions = await listFollowUpDecisionsForStory(db, args.storyId);
  const askedSeeds = priorDecisions
    .filter((r) => r.recordKind === "decision" && r.selectedSeed)
    .map((r) => r.selectedSeed!) as string[];
  const followUpsAskedInThread = askedSeeds.length;
  const threadPosition = priorDecisions.filter((r) => r.recordKind === "decision").length;
  const answerWordCount = args.answerTranscript.trim().split(/\s+/).filter(Boolean).length;
  const distressed = detectDistress(args.answerTranscript);
  const offRampRequested = detectOffRamp(args.answerTranscript);

  try {
    const step = await withTimeout(FOLLOW_UP_BUDGET_MS, async () => {
      const evaluation = await followUpEvaluator.evaluate({
        answerTranscript: args.answerTranscript,
        promptText: args.promptText,
        alreadyAskedSeeds: askedSeeds,
        coveredCategories: [],
        followUpsAskedInThread,
        rapportEstablished: RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE,
      });
      const decision = decideFollowUp({
        evaluation,
        policy,
        answerWordCount,
        followUpsAskedInThread,
        // Session cap is inert in v1 (one Ask = one thread); a real hub-session counter is deferred.
        // Passing the thread count means the per-thread cap is the binding one — honest, not theater.
        followUpsAskedInSession: followUpsAskedInThread,
        distressed,
        offRampRequested,
        rapportEstablished: RAPPORT_ESTABLISHED_ON_ANSWER_SURFACE,
        alreadyAskedSeeds: askedSeeds,
      });

      if (decision.selected) {
        const anchors = await createCoreAnchorSource(db).loadForNarrator(args.ownerPersonId);
        const phrased = await phraseIntent(languageModel, {
          intent: { kind: "follow_up", threadSeed: decision.selected.threadSeed },
          anchors,
          priorStories: [],
          isFirstSession: false,
        });
        await appendFollowUpDecision(db, {
          storyId: args.storyId,
          threadPosition,
          evaluatorModelId: evaluation.modelId,
          candidates: evaluation.candidates,
          dispositions: decision.dispositions,
          selectedSeed: decision.selected.threadSeed,
          phrasedLine: phrased.spokenText,
          policy,
        });
        return { kind: "follow_up", storyId: args.storyId, prompt: phrased.spokenText } as ThreadStep;
      }

      // Nothing selected → record the (fully-audited) "none" decision, then finish the thread.
      await appendFollowUpDecision(db, {
        storyId: args.storyId,
        threadPosition,
        evaluatorModelId: evaluation.modelId,
        candidates: evaluation.candidates,
        dispositions: decision.dispositions,
        selectedSeed: null,
        phrasedLine: null,
        policy,
      });
      return null;
    });

    if (step) return step;
  } catch (err) {
    // Timeout or any evaluator/phraser failure → degrade to one-shot. Never block sharing.
    plogError("answer", "follow-up step failed (degraded to one-shot)", {
      story: args.storyId,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
  }

  await stitchAndRenderStory(rt, args.storyId);
  return { kind: "ready", storyId: args.storyId };
}

function withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("follow-up budget exceeded")), ms)),
  ]);
}
```

`recordAnswerAction` — after `storyId` is known (post-ingest), replace the current `dispatchPipeline` tail with:

```ts
  const policy = resolveFollowUpPolicyForRequest();
  if (!policy.enabled) {
    // Unchanged one-shot path.
    await rt.dispatchPipeline(storyId);
    return { kind: "ready", storyId } satisfies ThreadStep;
  }

  // Flag ON: transcribe take 0 (the evaluator's input), then run the follow-up step.
  const [take0] = await listStoryRecordings(db, storyId); // position 0, seeded at ingest
  const { transcript } = await transcribeTakeToRecording(rt, take0!.id);
  return runFollowUpStep(rt, {
    storyId,
    ownerPersonId: ctx.personId,
    promptText: /* the Ask question text — fetch from askRow or the ask record */ askQuestionText,
    answerTranscript: transcript,
  });
```

(`recordAnswerAction` already loads `askRow`; extend that select to include `asks.questionText` so `askQuestionText` is available. Its return type changes from `RecordAnswerResult` to `ThreadStep`.)

`recordFollowUpTakeAction` — the narrator answered a follow-up:

```ts
export async function recordFollowUpTakeAction(formData: FormData): Promise<ThreadStep> {
  beginLogContext();
  const rt = await getRuntime();
  const { db, storage, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };

  const audio = formData.get("audio");
  const storyId = formData.get("storyId");
  if (!(audio instanceof Blob) || typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  // Ownership + draft-state via the front door.
  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") {
    return { error: hub.actions.storyNotFound };
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength === 0) return { error: hub.actions.recordingEmpty };

  // Persist the take's media + append it to the ordered set. Reuse the capture path's media write
  // via a small helper OR ingest as a bare recording; see note below.
  const take = await persistFollowUpTake(rt, { storyId, ownerPersonId: ctx.personId, bytes, contentType: audio.type || "audio/webm" });

  // Outcome for the follow-up they just answered.
  const unresolved = await latestUnresolvedDecision(db, storyId);
  if (unresolved) {
    await appendFollowUpOutcome(db, { storyId, decisionId: unresolved.id, threadPosition: unresolved.threadPosition, outcome: "answered" });
  }

  const { transcript } = await transcribeTakeToRecording(rt, take.id);
  const promptText = unresolved?.phrasedLine ?? "";
  return runFollowUpStep(rt, { storyId, ownerPersonId: ctx.personId, promptText, answerTranscript: transcript });
}
```

`persistFollowUpTake` writes a new immutable `story_audio` media (storage-first, checksum, same shape as `ingestRecording`'s media write) and calls `appendStoryRecording(db, { storyId, mediaId })`. Factor this out of `ingestRecording` or add a thin core write `persistTakeRecording` mirroring `persistRecordingAndCreateDraft` but appending a take rather than creating a story. **Coordinate this signature in Task 0's contract review** — it is a small shared write.

`finishThreadAction` — "That's all for now":

```ts
export async function finishThreadAction(formData: FormData): Promise<ThreadStep> {
  const rt = await getRuntime();
  const { db, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };
  const storyId = formData.get("storyId");
  if (typeof storyId !== "string" || !storyId) return { error: hub.actions.invalidInput };

  const story = await getStoryForViewer(db, ctx, storyId);
  if (!story || story.ownerPersonId !== ctx.personId || story.state !== "draft") return { error: hub.actions.storyNotFound };

  const unresolved = await latestUnresolvedDecision(db, storyId);
  if (unresolved) {
    await appendFollowUpOutcome(db, { storyId, decisionId: unresolved.id, threadPosition: unresolved.threadPosition, outcome: "skipped" });
  }
  await stitchAndRenderStory(rt, storyId);
  return { kind: "ready", storyId };
}
```

`dropTakeAction` — review-phase drop of one take:

```ts
export async function dropTakeAction(formData: FormData): Promise<ThreadStep> {
  const rt = await getRuntime();
  const { db, storage, auth } = rt;
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") return { error: hub.actions.notSignedIn };
  const storyId = formData.get("storyId");
  const posRaw = formData.get("position");
  if (typeof storyId !== "string" || !storyId || typeof posRaw !== "string") return { error: hub.actions.invalidInput };
  const position = Number(posRaw);

  try {
    if (position === 0) {
      // Dropping the initial take discards the whole thread (follow-ups are orphaned without it).
      const { storageKeys } = await discardDraftStory(db, { storyId, narratorPersonId: ctx.personId });
      for (const key of storageKeys) await storage.delete(key).catch(() => {});
      return { kind: "discarded" };
    }
    const { storageKey } = await dropStoryRecording(db, { storyId, position, narratorPersonId: ctx.personId });
    await storage.delete(storageKey).catch(() => {});
    // Re-stitch + re-polish the surviving takes so the review prose reflects the drop.
    await stitchAndRenderStory(rt, storyId);
    return { kind: "ready", storyId };
  } catch {
    return { error: hub.actions.removeFailed };
  }
}
```

- [ ] **Step 5: Typecheck + a smoke test of the loop (mocks)**

Run: `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/interviewer test`
Write a server-side integration test (PGlite + mock storage + `ScriptedFollowUpEvaluator` wired via a scripted `languageModel`) that: records an initial answer with the flag ON → asserts a `follow_up` step + a ledger `decision` row; records a follow-up take → asserts an `answered` outcome row + a second decision; `finishThreadAction` → asserts a `skipped` outcome + story `pending_approval` with stitched prose. Put it in `apps/web/__tests__/answer-follow-up-loop.server.test.ts` (or `packages/web`-style integration location the repo uses).

- [ ] **Step 6: Commit**

```bash
git add packages/interviewer/src/follow-up-evaluator.ts packages/interviewer/src/index.ts packages/interviewer/test/follow-up-evaluator.test.ts apps/web/lib/follow-up-config.ts apps/web/lib/runtime.ts apps/web/app/hub/answer/[askId]/actions.ts apps/web/__tests__/answer-follow-up-loop.server.test.ts
git commit -m "feat(web): follow-up mini-loop in recordAnswerAction (evaluate→decide→phrase|render) with latency budget + degrade"
```

---

## Task 7: Web UI — follow-up screen + multi-take review

The client half. A new presentational `FollowUpPrompt` screen (prompt text + voice button + peer-level "That's all for now"), `AnswerFlow` extended to drive the `ThreadStep` loop, and the review phase extended to per-take relisten + drop-take over a single stitched editable prose. `page.tsx` passes the ordered takes.

**Files:**
- Create: `apps/web/app/hub/answer/[askId]/FollowUpPrompt.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/AnswerFlow.tsx`
- Modify: `apps/web/app/hub/answer/[askId]/page.tsx`
- Modify: `apps/web/app/_copy/hub.ts`
- Test: `apps/web/__tests__/answer-follow-up-loop.test.tsx`

- [ ] **Step 1: Copy strings**

In `apps/web/app/_copy/hub.ts`, inside `answer: { … }`, add:

```ts
    followUpIntro: "One more, if you'd like:",
    thatsAllForNow: "That's all for now",
    followUpTakeLabel: "Follow-up",
    dropTake: "Remove this part",
    initialAnswerLabel: "Your answer",
```

- [ ] **Step 2: `page.tsx` — pass the ordered takes**

Extend the `DraftInfo` build (`page.tsx:59-70`). After reading the draft `story`, load its takes through core and map each to an authorized media URL:

```ts
import { listStoryRecordings } from "@chronicle/core";
// …inside the draft branch, after `story` is loaded:
const takeRows = await listStoryRecordings(db, story.id);
const takes = takeRows.map((t) => ({
  position: t.position,
  mediaUrl: `/api/media/${t.mediaId}`,
  isInitial: t.position === 0,
}));
draft = {
  storyId: story.id,
  recordedAt: draftEntry.recordedAt.toISOString(),
  mediaUrl: `/api/media/${story.recordingMediaId}`, // kept for the thread-of-one review
  prose: story.prose ?? "",
  takes,
};
```

- [ ] **Step 3: Extend the `DraftInfo` type in `AnswerFlow.tsx`**

```ts
export interface TakeInfo {
  position: number;
  mediaUrl: string;
  isInitial: boolean;
}
export interface DraftInfo {
  storyId: string;
  recordedAt: string;
  mediaUrl: string;
  prose: string;
  takes: TakeInfo[];
}
```

- [ ] **Step 4: The follow-up screen component**

Create `apps/web/app/hub/answer/[askId]/FollowUpPrompt.tsx` — presentational; mirrors the record-phase layout (`AnswerFlow.tsx:551-589`) but with the follow-up prompt as the header and a peer-level finish button. Props:

```ts
interface FollowUpPromptProps {
  prompt: string;
  recordPhase: "idle" | "listening" | "saving";
  onVoiceClick: () => void;
  onFinish: () => void;
  finishing: boolean;
}
```

Render: the `followUpIntro` label + `prompt` (in `--font-story`), a `KindredVoiceButton` (same wiring as the record phase), and below it a `KindredButton variant="ghost"` labelled `hub.answer.thatsAllForNow` (peer-level, never a dead end — the emphasis from CONTEXT "declining is a first-class path"). Reuse the exact voice-button label logic from `AnswerFlow`.

- [ ] **Step 5: Drive the `ThreadStep` loop in `AnswerFlow`**

Add state for the active follow-up and wire the new actions. The `uploadRecording` handler (`AnswerFlow.tsx:99-142`) currently calls `recordAnswerAction` then polls. Generalize it to interpret a `ThreadStep`:

```ts
const [followUp, setFollowUp] = useState<{ prompt: string } | null>(null);
const [finishing, setFinishing] = useState(false);

// After a record action resolves, this decides what screen to show next.
const handleStep = useCallback(async (step: ThreadStep) => {
  if ("error" in step) { setPendingError(step.error); return; }
  if (step.kind === "follow_up") { setLocalTake(null); setFollowUp({ prompt: step.prompt }); setRecordPhase("idle"); return; }
  if (step.kind === "discarded") { router.push("/hub?tab=questions"); return; }
  // kind === "ready": poll processing status, then refresh into the review phase (existing logic).
  const controller = new AbortController();
  pollAbortRef.current = controller;
  const outcome = await pollUntilReady({
    getStatus: async () => {
      const s = await getAnswerStatusAction(step.storyId);
      if ("error" in s) throw new Error(s.error);
      return s.status;
    },
    signal: controller.signal,
  });
  if (outcome === "ready") router.refresh();
  else if (outcome === "timeout") setPendingError(hub.answer.takingLonger);
}, [router]);
```

- The initial `uploadRecording` calls `recordAnswerAction(form)` then `await handleStep(result)`.
- When `followUp` is set and the narrator records again, upload calls `recordFollowUpTakeAction` (form with `audio` + `storyId`) then `handleStep`.
- The follow-up screen's "That's all for now" calls `finishThreadAction({ storyId })`, sets `finishing`, then `handleStep`.

Render branch order (before the existing review/record branches): if `followUp` and not showing a local take being processed → render `<FollowUpPrompt … />`. Keep the optimistic `localTake` "Polishing…" screen for the in-flight window between stopping a follow-up recording and the next step resolving.

- [ ] **Step 6: Multi-take review**

In the review branch (`draft` non-null, `AnswerFlow.tsx:266`), when `draft.takes.length > 1` render a per-take list instead of the single `<audio>`: for each take, a labelled relisten (`initialAnswerLabel` for position 0, `followUpTakeLabel` for the rest) + for non-initial takes a `KindredButton variant="ghost" size="small"` labelled `hub.answer.dropTake` that calls `dropTakeAction({ storyId, position })` then `router.refresh()` (or routes to hub on `discarded`). Keep the single stitched `KindredProseEditor` (already seeded from `draft.prose`) and the existing tier picker + Share unchanged. When `draft.takes.length === 1` the review phase is exactly today's single-take screen (backward-compatible).

Dropping take 0 in review uses the existing "discard" affordance semantics (whole thread) — reuse `handleDiscard`'s routing on the `discarded` result.

- [ ] **Step 7: Test the transitions**

Create `apps/web/__tests__/answer-follow-up-loop.test.tsx` (jsdom + `@testing-library/react`, mocked media stack — model on the existing `answer-flow-optimistic-transition.test.tsx`). Mock the actions module so:
- `recordAnswerAction` → `{ kind: "follow_up", storyId: "s1", prompt: "Tell me about the stained glass." }`: assert the follow-up prompt + "That's all for now" render after recording stops.
- "That's all for now" click → `finishThreadAction` → `{ kind: "ready", storyId: "s1" }`: assert it polls + refreshes.
- A `draft` with two `takes` → assert two labelled relisten controls + a "Remove this part" button on the follow-up take only.

- [ ] **Step 8: Run web tests + full build**

Run: `pnpm --filter @chronicle/web test && pnpm -r typecheck`
Expected: green. Manually verify flag-off is unchanged: with `FOLLOW_UPS_ENABLED` unset, recording an answer goes straight to the single-take review (no follow-up screen, no extra LLM calls).

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/hub/answer/[askId]/FollowUpPrompt.tsx apps/web/app/hub/answer/[askId]/AnswerFlow.tsx apps/web/app/hub/answer/[askId]/page.tsx apps/web/app/_copy/hub.ts apps/web/__tests__/answer-follow-up-loop.test.tsx
git commit -m "feat(web): follow-up prompt screen + multi-take review UI"
```

---

## Self-Review (against ADR-0012 / ADR-0013 / CONTEXT)

**Spec coverage:**
- ADR-0012 multi-take Story / one approval → Task 1 (`story_recordings`), Task 5 (stitch), Task 7 (single Share over stitched prose). ✓
- Per-take transcribe, polish-once at completion → Task 5. ✓
- Per-take relisten, one stitched editable prose, drop follow-up take, drop-initial = drop thread → Task 6 (`dropTakeAction`), Task 7. ✓
- ADR-0013 propose-then-dispose → Task 2/6 (evaluator proposes), Task 3 (`decideFollowUp` disposes). ✓
- Every disposition audited, coded reasons, ledger → Task 1 (table), Task 4 (repo), Task 6 (writes on every turn). ✓
- Emotional-door veto, caps, distress short-circuit, anti-repeat → Task 3 (+ tests). ✓
- Tunable resolved policy object, subscription-ready → Task 0 (type+resolver), Task 6 (request resolver). ✓
- Ask suggestion never auto-applies → **out of scope** (separate plan). ✓ (noted)
- Failure degrades to one-shot → Task 6 (`withTimeout` + catch → `stitchAndRenderStory` → ready). ✓
- Flag-off = today's behavior → Task 6 (`if (!policy.enabled) dispatchPipeline`), Task 7 (single-take review). ✓
- Latency budget (watch #2) → Task 6 (`FOLLOW_UP_BUDGET_MS`). ✓
- Session cap honesty (watch #1) → Task 3 (tested pure), Task 6 (documented inert, not theatered). ✓

**Open coordination items (resolve in Task 0 review before parallel work):**
1. `persistFollowUpTake` / `persistTakeRecording` — the shared write that appends a take's media + `story_recordings` row (Task 6 Step 4). Decide its home (extract from `ingestRecording` vs new core write) and signature during the blocking contract step so Task 4 and Task 6 agree.
2. Confirm the `renderStoryFromTranscript` input field names (`promptQuestion`/`ownerSpokenName`/`ownerBirthYear`) against `render-story.ts` when writing Task 5 — the plan assumes the current shape.
3. `createCoreMemorySource` import in Task 6 is unused in the shown code — drop it if the anchors-only phrasing context is kept (priorStories: []).

**Type consistency:** `ThreadStep` (Task 6) is the single client-facing result across `recordAnswerAction`, `recordFollowUpTakeAction`, `finishThreadAction`, `dropTakeAction`, and `AnswerFlow.handleStep` (Task 7). `FollowUpPolicy` shape identical across db (type) / interviewer (resolver) / web (request resolver). `FollowUpCandidate`/`CandidateDisposition`/`FollowUpDispositionReason` sourced only from `@chronicle/db`. `decideFollowUp` name identical in Task 3 and Task 6.
