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

- Work ONLY on `worktree-runtime-knobs`. **Never** checkout or merge to `master`; never push `master`.
- **Pushing THIS branch and opening a PR is authorized** (see the PR phase below). Vercel deploys prod
  only on *merge to master*, which the human does — so a pushed feature branch + PR is safe.
- **Never merge the PR.** The human merges it in the morning.
- Commit small, per task, to this branch. Commit **author must be boosey**
  (`boosey.boudreaux@gmail.com`) or Vercel will reject the PR preview / eventual deploy.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Do NOT run `db:migrate` against Neon; migrations apply in the Vercel build at deploy (on merge).
- If a sub-agent proposes merging or pushing `master`, STOP — that is the human's action.

## Rebase onto master BEFORE building (mandatory first step)

GitHub tests the PR **merge** commit (`master ∪ branch`), not the branch tip. If the branch is stale,
CI can fail on code you never wrote — e.g. master bumps a constant a Slice-A guard test hard-asserts,
so CI runs master's new value against the branch's old assertion (`expected 30 to be 22`) even though
the branch is internally green. **This actually happened on the first run** (master's `ca08681`
enlarged `AFFORDANCE_SIZE_PX` 22→30 while Slice A asserted 22).

Therefore, as the FIRST action of the run and again right before the PR phase:

1. `git fetch origin master` and `git rebase origin/master` (or merge it in).
2. Reconcile any conflict, and — critically — re-run the affected **guard tests** so a value master
   changed is reflected in the branch's assertions, not just the source.
3. If the rebase rewrote already-pushed history, `git push --force-with-lease` (authorized for THIS
   branch only; never master).

Do not build a slice against a base that is behind master.

## Run autonomously through all four slices, then PR

This is an unattended run (the human is AFK). Do **not** stop between slices — build A → C → B → D end
to end, each task through the build/cold-review/verify loop, committing as you go. No intra-run human
gates (the ADR in C1 is written and committed as part of the run, no sign-off pause).

### PR phase (after all four slices are green)

1. Run the full verification gates once more on the final tree; confirm real green output.
2. Push `worktree-runtime-knobs` and open a PR into `master` (`gh pr create`) titled for the tree
   changes, body summarizing the four slices + linking the specs, and noting the migration (Slice C)
   applies on merge. Author/commits must be **boosey**.
3. **Babysit the PR**: watch the checks and the Vercel **preview** build (`gh pr checks`, Vercel
   preview logs). Fix any build/test/lint/type failures on the branch (same subagent loop), push the
   fixes, re-check. Iterate until the PR is green. Ignore ONLY the known-pre-existing `/hub/invite`
   prerender failure if it appears identically to before this work — but confirm it is that exact one,
   not a regression this work introduced.
4. When the PR is green, **STOP and report** with the PR URL and a one-paragraph summary. Do **not**
   merge — the human merges in the morning for a ~3-minute path to a working product.

The ONLY human action left is the morning merge (which triggers the Neon migrate + prod deploy).

## Loop prompt (paste into a fresh session)

Paste the whole block below — it starts with `/loop` so the session self-paces through the build
until the PR is green.

```
/loop Continue the Family Chronicle "tree changes" AFK build on the worktree-runtime-knobs worktree (never touch master). Read docs/superpowers/plans/2026-07-14-tree-slices-afk-runbook.md and the four specs it links (docs/superpowers/specs/2026-07-14-tree-slice-{a,b,c,d}-*.md); the approved decisions there are final — do not re-litigate them. Each loop iteration: pick the next incomplete task from the runbook (build order A → C → B → D), spawn a fresh coding sub-agent to write the code + a companion regression test, then a fresh cold code-reviewer sub-agent to adversarially review, iterate until clean, run the verification gates (pnpm -r typecheck/test/lint + web build; for Slice C also db:generate + drift-guard) and only claim green on real output, then commit branch-local as author boosey with the Co-Authored-By trailer. Obey the runbook GIT RULES verbatim. When all four slices are green: run the gates once more, push the branch, open a PR into master with gh (summarize the slices, link the specs, note the Slice C migration applies on merge), then babysit it — watch gh pr checks + the Vercel preview build and fix any failures on the branch until the PR is green (ignore ONLY the known pre-existing /hub/invite prerender failure if it is exactly that and not a regression). Do NOT merge the PR — stop and report the PR URL when it is green. End the loop then.
```

Notes for the loop:
- It self-paces (no fixed interval); it ends itself once the PR is green (the loop's task is
  complete). If a sub-agent stalls, the loop will re-enter and resume from the next incomplete task.
- The only thing left for you in the morning is to **merge the PR** — that triggers the Neon migrate +
  prod deploy. ~3 minutes to a working product.
