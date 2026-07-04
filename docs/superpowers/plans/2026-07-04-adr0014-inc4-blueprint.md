# ADR-0014 Increment 4 — JIT blueprint (FULL build, schema change approved)

**Scope decision (2026-07-04, human sign-off):** Build the FULL intake unification, **including the
schema change** (append-only intake edit-history ledger) and the **Neon reseed** (both branches). The
user was told twice that the visible makeover needs no schema change and that intake audit-lineage has
weak value (owner-only, never shared); they chose the full build anyway. Proceed.

**Non-negotiables carried from the Inc 4/5 handoff + rollout §Inc 4:**
- Worktree `…/composing-surface-inc1-3`, branch `worktree-composing-surface-inc1-3`. Commit
  `--author="Alex Boudreaux <boosey.boudreaux@gmail.com>"` (Vercel gate). Do NOT merge/deploy.
- Subagent-driven TDD; a FRESH cold adversarial reviewer per slice on the immutable commit; iterate
  until clean. VERIFY EVERYTHING YOURSELF (`git show --stat`, `pnpm -r typecheck`, affected suites +
  full apps/web suite) — builders over-claim green.
- Reseed model (this worktree predates master's migration chain): schema ships as `schema.ts` +
  `invariants.sql` → `db:generate` → reseed. NO incremental migration here.
- Front door: `intake-answer-repository.ts` is ALREADY on the architecture allowlist — intake_revisions
  writes live there; no new allowlist entry.
- Intake/story WALL preserved: intake is NOT a story. Hence a SEPARATE `intake_revisions` ledger, not a
  polymorphic widening of `prose_revisions` (which would blast-radius the story front door). This is a
  deliberate, documented reading of ADR-0014 §8 "same … prose lineage" — same SHAPE + trigger, own table.

## Baselines at start (HEAD 8ed43c3): core 277, pipeline 74, capture 38, db 67, apps/web 403, typecheck 0.

---

## Slice 1 — `intake_revisions` ledger + core write surface (BLOCKING shared contract)

**schema.ts** (after `intakeAnswers`, ~line 383):
```ts
export const intakeRevisions = pgTable(
  "intake_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    intakeAnswerId: uuid("intake_answer_id")
      .notNull()
      .references(() => intakeAnswers.id, { onDelete: "cascade" }),
    level: proseRevisionLevelEnum("level").notNull(), // reuse the story enum verbatim
    text: text("text").notNull(),
    modelId: text("model_id"),
    promptText: text("prompt_text"),
    actorPersonId: uuid("actor_person_id").references(() => persons.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intake_revisions_answer_idx").on(t.intakeAnswerId)],
);
export type IntakeRevision = typeof intakeRevisions.$inferSelect;
export type NewIntakeRevision = typeof intakeRevisions.$inferInsert;
```
Lives in the MAIN schema (like `intakeAnswers`), NOT `@chronicle/db/content` — intake text is not
Story/Media content behind the authorization wall (owner-only access, server-resolved personId).

**invariants.sql** — append-only, but **UPDATE-only** guard (DELETE must pass so the FK cascade can
reclaim revisions on owner erasure; intake is never consented so there is no consent-scoped delete
guard like prose_revisions has):
```sql
CREATE OR REPLACE FUNCTION chronicle_forbid_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: UPDATE is not permitted (revisions are new rows).',
    TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER intake_revisions_append_only
  BEFORE UPDATE ON intake_revisions
  FOR EACH ROW EXECUTE FUNCTION chronicle_forbid_update();
```

**core/intake-answer-repository.ts** — add:
- `appendIntakeRevision(db, { intakeAnswerId, level, text, modelId?, promptText?, actorPersonId? }): Promise<IntakeRevision>`
- `listIntakeRevisions(db, intakeAnswerId): Promise<IntakeRevision[]>` (ordered by seq)
Export from `@chronicle/core` index. Do NOT bake level-selection into `saveIntakeText`/`saveIntakeTranscript`
— the ACTION layer (S2/S3) knows the semantic level and calls `appendIntakeRevision`.

**Tests (PGlite, packages/core + packages/db):** append returns a row; a second append increments seq;
UPDATE on intake_revisions raises restrict_violation; deleting the parent intake_answer cascades its
revisions; enum round-trips.

**Gate:** `pnpm --filter @chronicle/db db:generate` regenerates schema.sql + invariants.sql; core+db
suites green; typecheck 0.

---

## Slice 2 — intake Cleanup + Polish text ops
- Pipeline: reuse the per-take `cleanupTake` (Inc 1) and the Polish prompt. Actions in `about-you/actions.ts`:
  - transcription path also runs Cleanup on the transcript before returning it (best-effort; on failure
    return the raw transcript). Log `ai_transcribed` then `ai_cleaned` via `appendIntakeRevision`.
  - `polishIntakeAnswerAction(personId-less; key + prose)` → text→text Polish; persists `text`; logs
    `ai_polished`. Owner-resolved server-side.
- Tests: cleanup applied; polish returns tidied text + logs a row.

## Slice 3 — intake editor makeover (shared ProseBlock)
- Extract `ProseBlock` (+ any trivially-shareable capture bits) from `ComposingEditor.tsx` into a shared
  module (e.g. `apps/web/app/hub/_composing/ProseBlock.tsx`); import in BOTH. Do NOT move the story
  lifecycle machine. Keep ComposingEditor green (regression-sensitive; freshly cold-reviewed).
- Rework `AboutYouFlow`: per-question mini composing surface — voice/type → transcribe → Cleanup → seed
  the ProseBlock editor (undo/redo + ✨Polish) → edit → Next. `saveIntakeAnswer` logs `human_corrected`
  when the saved text differs from the last revision, then extracts the field + advances.
- Update `apps/web/__tests__/about-you-flow.test.tsx`.

## Slice 4 — narrator-memory seam stub + §9 gating tests
- core: `extractNarratorMemory(...)` no-op write-seam (documented deferred model).
- Call-sites, consent-gated: post-approval story (`shareAnswerAction`, after augment) + intake Save
  (`saveIntakeAnswer`). Best-effort.
- Regression tests: discarded/unshared draft never feeds; story feeds post-approval only; intake at Save.

## Slice 5 — reseed (HUMAN-GATED) + doc-true
- `db:generate` final; reseed dev; **PAUSE for user go-ahead before the destructive Neon reseed of both
  branches**. Update ADR-0014 §8/§9 (separate intake_revisions ledger; wall preserved), PLAN/PROGRESS/memory.
- Leave the branch committed + green. Do NOT merge/deploy.

## Stop conditions
Frozen story shared-contract (§4 core signatures) would need changing; a story-side schema change
(intake_revisions is additive + isolated, so it is NOT a story-contract change); a slice can't go green
after two builder+review rounds. Commit what's green, record the blocker, stop.
