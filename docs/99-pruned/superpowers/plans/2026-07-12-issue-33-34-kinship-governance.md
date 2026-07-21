# Issues #33 + #34 — Kinship governance (steward affirm/deny/correct) + subject-hide veto

Date: 2026-07-12
Branch: `worktree-issue-33-steward-hide` (stacked on #32 `c73768a`)
ADR: `docs/adr/0016-kinship-is-a-steward-governed-per-family-tree.md`

## Load-bearing invariant (user clarification)

**The Steward is NOT a visibility gate.** An asserted edge is fact IMMEDIATELY on assertion
(first-asserter-wins). Steward `affirm` is an OPTIONAL endorsement, never a prerequisite for the edge
to show. Steward `deny`/`correct` are after-the-fact moderation. A subject `hide` (#34) overrides even
a steward affirm. The read projection (`resolveKinshipProjection`, `VISIBLE_STATES =
asserted|affirmed|corrected`, plus the subject-hide overlay) already encoded this and was NOT
weakened — the new code only appends superseding ledger rows that the projection resolves latest-wins.

## What was built

All core code extends the two already-allowlisted kinship files (no new KINSHIP_ALLOWLIST entry, no
new migration — both edge tables shipped in migration 0009). Web integration mirrors the #32
`addRelativeAction` pattern.

### Issue #33 — Steward governance (`packages/core/src/kinship-write.ts`)

Shared:
- `EdgeRef` — a logical edge identity `{ familyId, edgeType, personAId, personBId }`; every function
  normalizes via `normalizeEdgeEndpoints` before touching the ledger.
- `KinshipEdgeActionResult` — `{ allowed, reason?, edgeId? }`, mirrors `AddRelativeResult`; the
  auth-denial path returns `{allowed:false, reason}` rather than throwing.
- `latestEdgeRow` — resolves an edge's current row (latest by seq, over ALL states) to (a) verify the
  edge exists before a steward transition and (b) carry the current nature forward.
- `requireStewardOverExistingEdge` — the shared server-side gate: `ctx.kind==="account"` AND
  `ctx.personId === families.stewardPersonId` AND the edge already exists. Returns normalized
  endpoints + current nature.

Functions:
- `affirmEdge(db, ctx, ref, note?)` → appends a superseding `affirmed` row.
- `denyEdge(db, ctx, ref, note?)` → appends a `denied` row; the projection then omits the edge
  (VISIBLE_STATES excludes `denied`) while history survives (append-only).
- `correctEdge(db, ctx, { ref, nature, note? })` → appends a `corrected` row with a NEW nature.

**Correct-signature decision (nature-only).** `correctEdge` corrects a `parent_of` edge's `nature`
only (part of the mutable payload, not the edge key), producing a clean same-edge-key supersede.
Correcting an ENDPOINT (wrong parent/child) is a DIFFERENT logical edge, so it is expressed as
`denyEdge` (the wrong edge) + a fresh assertion (`addRelative` / a new asserted row) — NOT folded into
`correctEdge`, which would otherwise have to invent a second logical edge inside a "correct". This
keeps each governance op a single append on one edge key. `correctEdge` rejects `partnered_with`
(which carries no nature per the DB check constraint).

**Nature carry-forward (code-review fix).** `affirm`/`deny` are pure supersedes and must not lose
information. They CARRY FORWARD the edge's current `nature` (from `latestEdgeRow`) rather than a
hardcoded value. The first implementation hardcoded `nature: "unknown"` for `parent_of`, which a cold
reviewer caught as silent data loss: correct→adoptive then affirm would reset nature to `unknown`
because the projection reads the whole latest row (including nature). Fixed via `natureToCarryForward`
(+ regression test "correct then affirm PRESERVES the corrected nature").

### Issue #34 — Subject-hide veto (`packages/core/src/kinship-write.ts`)

- `hideEdge(db, ctx, ref)` / `unhideEdge(db, ctx, ref)` — append a `kinshipSubjectHides` row
  (`hidden` true/false), latest per (edge, subject) wins.
- Gate (`appendSubjectHide`): `ctx.kind==="account"` AND the actor is an ENDPOINT of the edge AND that
  endpoint holds a real account (`persons.accountId !== null`). A `mention` has `accountId = null`, so
  the control is absent for mentions. A non-endpoint cannot hide on someone else's behalf. Hide
  overrides even a steward affirm (enforced by the existing read overlay; verified by test).

### Read composition (`packages/core/src/kinship-repository.ts`)

`listGovernableKinEdges(db, ctx, familyId)` → the family's currently-VISIBLE edges (auth + visibility
+ hide already applied by `resolveKinshipProjection`), each annotated with endpoint display names and
two viewer capability flags: `viewerIsSteward` (may affirm/deny/correct) and `viewerCanHide` (viewer
is a self-account endpoint of THIS edge). Flags are UI affordances only; the write path re-checks every
gate. No content-table access — kinship stays behind its own front door.

### Web (`apps/web/app/hub/kin/`)

- `actions.ts` — `affirmEdgeAction`/`denyEdgeAction`/`correctEdgeAction`/`hideEdgeAction`/
  `unhideEdgeAction`, all via a shared `runEdgeAction` (beginLogContext → getRuntime → auth guard →
  parse edge identity from untrusted form → re-validate `familyId` against the caller's own active
  families → core call, which owns the real authorization → revalidatePath). The family re-validation
  is defense-in-depth; core re-checks steward/endpoint on top.
- `kin-edge-controls.tsx` — renders ONLY the controls the viewer is entitled to (steward → Endorse /
  Remove; self-endpoint subject → Hide), each a tiny form carrying the edge identity.
- `page.tsx` — a "Relationships in this family" section (shown only when the viewer can act on ≥1 edge)
  listing each visible edge as an ungendered sentence + the entitled controls.

Note: `correctEdgeAction`/`unhideEdgeAction` are exported and fully tested at the core level but the v1
UI surfaces affirm/deny/hide only (correct + unhide are API-complete, UI deferred — a nature-correction
picker and an un-hide affordance are straightforward follow-ons).

## Test coverage

- `packages/core/test/kinship-governance.test.ts` (#33): affirm/deny/correct happy paths + append-only
  row-count assertions; non-steward rejected (each op); anonymous rejected; non-existent edge rejected;
  deny→projection-empty-history-intact regression; deny `note` recorded; correct rejects
  `partnered_with`; correct→affirm nature-preservation regression; `listGovernableKinEdges` flag tests.
- `packages/core/test/kinship-subject-hide.test.ts` (#34): self-endpoint hide→suppressed→unhide→restored;
  affirm-then-hide precedence regression; non-endpoint rejected; mention endpoint rejected; anonymous
  rejected; non-existent edge rejected.

## Verification (all GREEN)

- `pnpm --filter @chronicle/core test` — 39 files, 402 tests pass (incl. architecture guard, which
  passes with KINSHIP_ALLOWLIST unchanged).
- `pnpm --filter @chronicle/core typecheck`, `pnpm --filter @chronicle/web typecheck` — clean.
- `pnpm --filter @chronicle/web test` — 83 files, 616 tests pass.
- `pnpm --filter @chronicle/db test` — 16 files, 82 tests pass (no schema/drift change).

## Deviations from the issue specs

- `correctEdge` handles NATURE correction only; endpoint correction is deny + re-assert (documented
  above). This matches "at minimum support nature-correction … and denying+re-asserting a wrong
  endpoint; keep it minimal but coherent."
- Web UI surfaces affirm/deny/hide; correct + unhide are core-complete but not yet wired to a control.
