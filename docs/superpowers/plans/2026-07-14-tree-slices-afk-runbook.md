# AFK continuance runbook — Tree changes (Slices A–D)

**Date:** 2026-07-14
**Worktree branch:** `worktree-runtime-knobs` (do NOT work on `master`)
**Author gate:** commit as **boosey** (`boosey.boudreaux@gmail.com`) — Vercel blocks non-boosey commits.
**Mode:** subagent-driven, HITL for integration. A fresh Claude Code session can execute this
end-to-end unattended, stopping at the human gates.

## What this is

Four approved design specs decompose the user's 10 tree changes. This runbook is the ordered build
plan + the review loop + the guardrails so an autonomous session can carry the work forward without
the user present.

Specs (read the relevant one before building its slice):
- Slice A — `docs/superpowers/specs/2026-07-14-tree-slice-a-ux-design.md` (pure UI)
- Slice B — `docs/superpowers/specs/2026-07-14-tree-slice-b-contributions-design.md`
- Slice C — `docs/superpowers/specs/2026-07-14-tree-slice-c-person-editing-design.md` (ADR + migration)
- Slice D — `docs/superpowers/specs/2026-07-14-tree-slice-d-invite-design.md`

## Approved decisions (do not re-litigate — the user already chose these)

- **Focus person ≠ camera.** Clicking never changes the focus person; only the kebab **Focus** does.
  Initial focus centered once, then **no** automatic camera movement (incl. on re-focus).
- Focus = **server re-root** (`fetchSubtree`) + relabel + move ring, with a pan-delta so the viewport
  holds still.
- Single tap = no-op; **double-click** opens a **read-only** details sheet (edit is Slice C).
- Details sheet includes the three nav links now; Stories/Photos are **disabled** until Slice B.
- Relation chips are focus-relative; focus card blank; **viewer's card reads "You"**.
- Focus ring in the person's sex color; **neutral `--border-strong`** when sex unknown.
- FamilySearch colors: `--sex-male: #436b95`, `--sex-female: #ba412f`.
- Controls (Fit/−/+) lifted into the view-selector row, right-justified (lift `pan`/`scale`, `fit()`
  via imperative handle; portal alternative allowed).
- Slice B = **one** `/hub/person/[personId]` page with Stories | Photos | Mentions tabs.
- Slice C edit policy: **self OR creator OR steward OR (deceased AND active-family-member)**; living
  non-self editable only by steward/creator. Single `canEditPerson` predicate = UI gate + write guard.
- Slice D invite affordance lives in the **details sheet + kebab**, shown only when `invitable`.

## Build order & dependencies

```
A (pure UI, no backend)  ──►  B (person page + core reads)
        │                      C (ADR + migration + write path)   } B, C, D each depend on A only;
        └────────────────►     D (invite status + wiring)         }  B, C, D are independent of each other
```

Recommended sequence: **A → C → B → D** (do C early — it carries the migration and ADR, the longest
pole; B and D are lighter). B, C, D may also run as **parallel worktrees** off A if you want an agent
team — but only after A is merged into this branch, and each in its own isolated worktree (see the
worktree-isolation rule). If unsure, go strictly sequential.

## The per-task loop (repo convention — subagent-driven)

For **each task** below:

1. **Build** — spawn a fresh coding sub-agent with: the slice spec section, the task, the approved
   decisions above, and the GIT RULES. It writes the code + companion regression test(s).
2. **Cold review** — spawn a **separate, fresh** adversarial `code-reviewer` sub-agent (new one each
   round — fresh eyes). It reviews the diff against the spec + repo conventions (front door,
   determinism, centralized constants/copy, vendor seams).
3. **Iterate** — the coding sub-agent consumes the review and fixes; re-review with a NEW reviewer
   until clean.
4. **Verify** (see gates) before moving to the next task.

The main session orchestrates only; it does not write the code itself.

## Verification gates (run from repo root, must pass before a slice is "done")

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r lint`
- `pnpm --filter @chronicle/web build` (catches the prerender landmines; note `/hub/invite`
  prerender is a PRE-EXISTING failure — PGlite wasm in the build worker — not caused by this work).
- Slice C only: after `schema.ts` edits run `pnpm --filter @chronicle/db db:generate` and confirm the
  **drift-guard** test (`test/migration-drift.test.ts`) is green; hand-carry any invariant change into
  the emitted migration.

State the actual command output when claiming green — evidence before assertions.

## Task breakdown

### Slice A — tree UX (no backend)

- A1. **Terminology/camera rename** — split focus-person from camera; rename `focusPos`→`cameraAnchor`,
  `centerOnFocus`→`centerCamera` (+ comments). No behavior change. Update `tree/CONTEXT.md` §0 note.
- A2. **Remove `PersonPanel`** — delete `person-panel.tsx`; strip its wiring + `selected` state.
- A3. **Pan-from-anywhere** — cards no longer swallow pan; a drag past `DRAG_SLOP_PX` starting on a
  card pans. Carets/kebab keep `stopPropagation`. Regression test: drag-on-card pans.
- A4. **Double-click details sheet** — new read-only `person-details.tsx` (name, dates, relation-to-
  viewer, three nav links w/ Stories+Photos disabled). `DOUBLE_TAP_MS` constant. Regression:
  double-click opens; single click no-op.
- A5. **Kebab `Focus` item** — add before Add…; `onFocus(personId)` = `fetchSubtree` re-root +
  set `focusPersonId` + pan-delta so camera holds still. Regression: re-focus relabels but pan/scale
  visually unchanged.
- A6. **FamilySearch colors** — token values in `_kindred/tokens.css`.
- A7. **Focus ring** — sex-color ring on the focus card; neutral when unknown; moves on re-focus.
  Ring-width token. Regression: ring follows focus.
- A8. **Relation-to-focus chips + "You"** — chip per card from `relationToRoot`; focus card blank;
  viewer card "You". `hub.tree.youLabel`. Regression: chip/`You`/blank-focus.
- A9. **Controls into the selector row** — lift `pan`/`scale` to `FamilyTab`; `fit()` imperative
  handle; right-justify; controls only in tree view. Regression: controls drive canvas; list hides.

### Slice C — cross-person editing (ADR + migration; do early)

- C1. **ADR** — write `docs/adr/ADR-00NN-person-record-editing.md` (policy, provenance field,
  choke-point). Link from `docs/DECISIONS.md`. (Human may want to eyeball before code — optional gate.)
- C2. **Migration** — add `persons.createdByPersonId` (nullable FK, immutable). `db:generate`;
  drift-guard green.
- C3. **Set provenance** — populate `createdByPersonId` on every Person-mint path (`addRelative`,
  invitee, mention).
- C4. **`canEditPerson`** — single predicate (self/creator/steward/deceased-family). Exhaustive truth-
  table test.
- C5. **`updatePersonIdentityAsEditor`** — guarded write choke point; reuse field setters. Reject
  disallowed editors even when called directly.
- C6. **Details sheet edit mode** — Edit button gated by projected `editable`; inline form; save →
  refetch anchor. `#5`: unknown card opens directly in edit mode; naming flips `identified`.

### Slice B — contribution destinations

- B1. **Core reads** — `listStoriesNarratedByPerson`, `listPhotosContributedByPerson` (authorized,
  narrows-never-grants). Test: cross-family row excluded.
- B2. **`/hub/person/[personId]` page** — tabbed shell (Stories | Photos | Mentions); `?section=`
  deep-link; fold in the old `/hub/about` as Mentions. Empty states.
- B3. **Wire links live** — details-sheet links point at the page (drop "coming soon"); kebab gains
  Stories/Photos/Mentions before Focus.

### Slice D — invite affordance

- D1. **`inviteStatus` projection** — compute in `resolveKinshipTree`; add to `TreeNode`. Truth-table
  test. No content-front-door widening.
- D2. **UI** — Invite button/note in the details sheet + Invite… kebab item, eligibility-gated;
  reuse the existing invite flow. Test: shows only for `invitable`; inviting hits `createInvitation`.

## GIT RULES (mandatory — put these verbatim in every sub-agent prompt)

- Work ONLY on `worktree-runtime-knobs`. **Never** checkout, merge to, or push `master`.
- **Never merge** any branch. **Never push.** Integration to master is a HUMAN action (HITL).
- Commit small, per task, to this branch. Commit **author must be boosey**
  (`boosey.boudreaux@gmail.com`) or Vercel will reject the eventual deploy.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Do NOT run `db:migrate` against Neon; migrations apply in the Vercel build at deploy (human-gated).
- If a sub-agent proposes a git action beyond a branch-local commit, STOP and surface it to the human.

## Human gates (STOP and report; do not proceed autonomously past these)

1. After **Slice A** is green — report for a look before starting the backend slices.
2. **Slice C ADR (C1)** — optional human sign-off on the edit-authorization policy before writing the
   write path.
3. **Any merge to `master` / push / Neon migrate** — always human.
4. Final: all four slices green → summarize; the human decides merge + deploy.

## Self-contained continuation prompt (paste into a fresh session)

> You are continuing the Family Chronicle "tree changes" work on the `worktree-runtime-knobs`
> worktree (do not touch master). Four approved specs live in
> `docs/superpowers/specs/2026-07-14-tree-slice-{a,b,c,d}-*.md` and the build plan +
> guardrails are in `docs/superpowers/plans/2026-07-14-tree-slices-afk-runbook.md`. Execute the
> runbook in order (A → C → B → D), subagent-driven: a fresh coding sub-agent per task writes code +
> a companion regression test, then a fresh cold `code-reviewer` sub-agent reviews, iterate until
> clean, then run the verification gates and report their real output. Obey the GIT RULES verbatim
> (branch-local commits only, author boosey, never merge/push/migrate — those are human gates). Stop
> and report at each human gate, starting with "Slice A green." Do not re-litigate the approved
> decisions listed in the runbook.
