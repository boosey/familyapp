# Inc 0 — Provenance vocabulary + core contract (detailed plan)

> Just-in-time detailed plan for **Increment 0** of the ADR-0014 rollout
> (`docs/superpowers/plans/2026-07-03-composing-surface-adr0014-rollout.md`). BLOCKING — must land
> green before Inc 1/2 start. Executed via the repo subagent workflow (fresh implementer + fresh
> adversarial reviewer). TDD.

## Goal

Rename the prose-provenance enum so names match ADR-0014 §2, and repoint the automatic render pass to
the new name. Smallest change that unblocks everything. **No behavior change** — this is a pure
vocabulary correction: the level that today's automatic render pass writes is renamed
`ai_polished → ai_cleaned`, and a **new** `ai_polished` value is added to name the *manual* Polish
button that later increments (Inc 2/3) will write.

## The rename, precisely

Today `ai_polished` means "the automatic light render pass (L2)". ADR-0014 splits that word:
- **`ai_cleaned`** (NEW name for the old value) = the automatic, per-take Cleanup pass. Every current
  code path that writes `ai_polished` today is writing *this* — the automatic pass — so every current
  write site moves to `ai_cleaned`.
- **`ai_polished`** (NEW value, same string, new meaning) = the human-confirmed manual Polish button.
  **Nothing writes it in Inc 0** — it is added to the enum now so Inc 2/3 can write it. Reserved-but-present.

Final enum value set (oldest→newest, `schema.ts`):
`user_authored, ai_transcribed, ai_cleaned, ai_polished, human_corrected, ai_verified`

## Files & exact edits

**Source (rename automatic-pass writes to `ai_cleaned`):**
1. `packages/db/src/schema.ts` (~143) — enum: rename `"ai_polished"` → `"ai_cleaned"`; insert a new
   `"ai_polished"` after it (final order above). Update the doc comment (~138–142) to describe both:
   `ai_cleaned` = automatic per-take Cleanup; `ai_polished` = the manual, human-confirmed holistic pass.
2. `packages/pipeline/src/orchestrator.ts` (~287) — the render-stage L2 `appendProseRevision`:
   `level: "ai_polished"` → `"ai_cleaned"`. Fix the surrounding comments (~283–284) that call it the
   "ai_polished row" / "AI-polished output" → "ai_cleaned row" / "cleaned (Cleanup) output".
3. `packages/pipeline/src/multi-take.ts` (~152) — same L2 append: `"ai_polished"` → `"ai_cleaned"`;
   comment (~149) accordingly.
4. `apps/web/lib/dev-seed.ts` (~471) — the seeded rendered answer's L2 append: `"ai_polished"` →
   `"ai_cleaned"` (it seeds the automatic render output).
5. `packages/core/src/story-repository.ts` (~992) — comment only: "the L2→L3 diff (ai_polished vs
   human_corrected)" → "(ai_cleaned vs human_corrected)".
6. `packages/db/drizzle/schema.sql` — **do NOT hand-edit.** Regenerate with
   `pnpm --filter @chronicle/db db:generate` (drizzle-kit export). Confirm the enum line updates.

**Tests (assert the automatic pass now writes `ai_cleaned`):**
7. `packages/pipeline/test/pipeline.test.ts` — line ~514 assertion `["ai_transcribed","ai_polished"]`
   → `["ai_transcribed","ai_cleaned"]`; line ~565 `r.level === "ai_polished"` → `"ai_cleaned"`; update
   the `it(...)` title (~498) and the comment (~543) from `ai_polished` → `ai_cleaned`.
8. `packages/pipeline/test/stitch-render.test.ts` — line ~149 assertion → `ai_cleaned`; comment ~147.

**Tests deliberately left unchanged (with a one-line note in the report why):**
- `packages/db/test/prose-revisions.test.ts` (77,105) and `packages/core/test/prose-revisions.test.ts`
  (105,120) use `ai_polished` only as an *incidental sample level* to exercise ledger
  append/immutability mechanics. `ai_polished` is still a valid enum value, so these stay green and
  keep meaningful coverage. Do not churn them.

## TDD sequence

1. **RED (rename regression):** Edit the two pipeline test assertions (#7, #8) to expect `ai_cleaned`.
   Run `pnpm --filter @chronicle/pipeline test` → they FAIL (code still writes `ai_polished`). This is
   the regression test proving the automatic pass is repointed.
2. **RED (new-value round-trip):** Add one focused test in `packages/db/test/prose-revisions.test.ts`
   proving the enum now accepts **both** `ai_cleaned` and `ai_polished` as distinct insertable levels
   (append one row of each, list, assert both present in order). Run → FAILS to compile/insert because
   `ai_cleaned` isn't in the enum yet.
3. **GREEN:** Apply source edits #1–#5, then run `db:generate` (#6). Run `pnpm --filter @chronicle/db
   db:generate`, then `pnpm --filter @chronicle/db test` and `pnpm --filter @chronicle/pipeline test`.
4. **Full sweep:** `pnpm -r test` and `pnpm -r typecheck` → all green (web dev-seed change compiles;
   architecture tests unaffected — no new content imports).

## Acceptance criteria

- Enum in `schema.ts` and regenerated `schema.sql` = the six values above, with `ai_cleaned` present
  and `ai_polished` retained.
- No source file writes `ai_polished` anymore (grep: only the new enum value definition + comments +
  the incidental ledger-mechanics tests remain).
- A rendered voice draft's lineage is `[ai_transcribed, ai_cleaned]` (pipeline + stitch-render tests).
- `pnpm -r test` and `pnpm -r typecheck` fully green.
- Architecture/front-door tests untouched and passing (no ALLOWLIST change needed).

## Out of scope (guard against overbuild)

- No new write path for the manual `ai_polished` (that's Inc 2/3).
- No pipeline restructuring, no per-take split (that's Inc 1).
- No Neon reseed here — deferred to the pre-merge/pre-deploy operational step (schema-parity gate).
  Tests use PGlite which applies the regenerated `schema.sql` in-process, so no DB provisioning needed.
