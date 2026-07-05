# Unit 05 — Edit story prose (post-share)

**Prerequisite:** Unit 01 (Story Action Shell — `isOwner`, `OwnerActionMenu`, the
server-action convention). This unit adds an "Edit story" menu item to that shell.
**Migration:** none (reuses the existing `human_corrected` prose-revision level — see Spec).
**Blast radius:** one new core function + its export, one route server action, and an
edit-mode toggle on the story read surface.

## Purpose

Let a story's **OWNER** edit the prose **body** of a story that is already
`approved`/`shared` (consented). Today every prose-edit path in `story-repository.ts`
(`saveProseCorrection`, `logPolish`, `finishDraft`) is restricted to `draft`/
`pending_approval`; there is **no** owner-gated write path for a story that has already
been shared. This unit adds one.

**The load-bearing rationale — editing shared prose is FREE, with NO re-consent:**
consent in Family Chronicle governs *who a story is shared with* (the audience — the
consent ledger + `story_families` targeting), **not a text freeze**. The prose is the
author's own words; letting them fix a typo or reword a sentence after sharing does not
change who can see it, so it needs no new `approved_for_sharing` consent event. What it
**does** require is provenance: **every edit appends one `prose_revisions` audit row**, so
the lineage of the author's own changes stays complete and inspectable. That append-only
audit trail is the entire price of the freedom — state it plainly in code comments and PR.

This is deliberately narrower than a "re-share" flow: no notification, no re-approval, no
audience change. Only the words move; the audit ledger records that they did.

## Spec

### Behavior

- **Owner:** `OwnerActionMenu` (⋮) → **"Edit story"** → the prose body region on the read
  surface switches from `StoryReadBody` (read-only) into `KindredProseEditor`, **prefilled
  with the current prose**. Owner edits → **Save** → server action → `editStoryProse` →
  `revalidatePath` → the surface re-renders read-only with the new prose; every family
  member who can see the story now sees the updated text. **Cancel** discards the edit
  (client-only; nothing is written).
- **Non-owner:** no affordance at all (the menu itself renders nothing for non-owners per
  Unit 01). They see the prose read-only exactly as today, via `StoryReadBody`.
- **No notification** is emitted to the family on edit. This is acceptable per the locked
  decision (it's the author's own words, audience unchanged), but is called out as a known
  gap in Adversarial notes — a silent post-share divergence from the text a reader may have
  already read.

### New core function

Add to `packages/core/src/story-repository.ts` (already on the front-door ALLOWLIST) and
export from `packages/core/src/index.ts` (alongside `saveProseCorrection` / `logPolish`).

```ts
export interface EditStoryProseInput {
  storyId: string;
  /** The new prose body. */
  prose: string;
  /** The editor — MUST equal the story owner. */
  actorPersonId: string;
}

export async function editStoryProse(
  db: Database,
  input: EditStoryProseInput,
): Promise<Story>;
```

Semantics (mirror `saveProseCorrection` ~L1414, minus its state restriction):

1. Load `{ ownerPersonId, state }` for `storyId` in a `db.transaction`; throw if not found.
2. **Owner gate:** `current.ownerPersonId !== input.actorPersonId` → `InvariantViolation`.
   This is the authoritative check; the server action's auth read is defense-in-depth.
3. **Allowed states — the key difference from every existing path:** allow the full set of
   states the owner controls: **`draft`, `pending_approval`, `approved`, `shared`.** In
   practice this unit's UI only exposes it post-share (`approved`/`shared`), but there is no
   reason to forbid the owner editing their own prose in any state — restricting it would
   just recreate the gap this unit exists to close. (See Adversarial notes on how this
   overlaps with `saveProseCorrection` for `pending_approval`.) The story state enum is
   `["draft","pending_approval","approved","shared"]` (`storyStateEnum`, schema.ts L62); we
   accept all four. Do **not** call `assertStoryTransition` — state does **not** change; only
   `stories.prose` and `updatedAt` change.
4. **Write + audit, in the one tx:**
   - `UPDATE stories SET prose = <trimmed>, updatedAt = now() WHERE id = storyId`.
   - `INSERT prose_revisions { storyId, level: "human_corrected", text: <trimmed>,
     actorPersonId, modelId: null, promptText: null, storyRecordingId: null }`.
   - Trim the prose before both writes (match `logPolish` L1364) so a no-op re-save doesn't
     spuriously append a whitespace-only revision.
5. Return the updated `Story` row.

### Revision level used — no migration

Reuse the **existing** `human_corrected` value of `proseRevisionLevelEnum`
(schema.ts L149–156: `user_authored, ai_transcribed, ai_cleaned, ai_polished,
human_corrected, ai_verified`). A human directly editing prose *is* exactly what
`human_corrected` denotes (`actorPersonId` set, `modelId`/`promptText` null — matching the
column semantics documented at schema.ts L552–557). **No new enum value, therefore no
schema change and no migration.** A distinct level like `human_post_share_edit` was
considered and rejected: it would require an enum value addition + a drizzle migration +
hand-carried invariant work, and it buys nothing — the audit row already carries the
timestamp (`createdAt`/`seq`) and the story's state is derivable, so "post-share" is
already reconstructable from existing columns. If a future need arises to *distinguish*
post-share edits in analytics, add the level then; do not pre-invent it here.

### Prose ≠ transcript invariant (audio stays canonical)

Per repo policy (audio-when-present stays canonical; `applyTranscriptCorrection` is the
only path that touches transcript), `editStoryProse` **must NOT touch the transcript or the
recording**. The data model keeps these strictly separate: `stories.prose` is a distinct
column from the transcript, and the audio takes live in `story_recordings` (referenced by
`prose_revisions.storyRecordingId`, which we set to **null** for this holistic human edit —
this row derives from no single take). Editing prose leaves `stories.transcript`,
`story_recordings`, and all recording media **untouched**. The read surface's Prose ↔
Transcript toggle (`StoryReadBody`) therefore continues to show the *original* transcript
alongside the *edited* prose — which is correct: the transcript is the verbatim record of
what was said; the prose is the author's presentable version and is theirs to edit.

### Consent ledger untouched

`editStoryProse` writes **nothing** to `consent_records` and does **not** re-target
`story_families`. The `prose_revisions` append is permitted post-share: the delete-guard
trigger (`chronicle_prose_revision_delete_guard`, invariants.sql L59) forbids only
`UPDATE` (always) and `DELETE` (once the story has consent rows) — plain `INSERT` of a new
revision is always allowed, which is exactly the append-only shape this unit relies on.

### Concurrency / staleness stance

There is a known lost-update window shared with `saveProseCorrection`/`logPolish` (see the
prose-provenance follow-ups memory): the editor prefills from a prose snapshot read at page
render; two concurrent owner sessions (or a stale tab) could each `UPDATE stories.prose`,
and last-writer-wins silently clobbers the other — while **both** edits still append audit
rows, so the ledger is honest even though the live prose reflects only one. For a
single-owner, low-frequency edit surface this is low risk.

**Recommended guard (optimistic concurrency):** thread the story's `updatedAt` (or the
latest `prose_revisions.seq`) that the editor was prefilled from into the server action and
`editStoryProse`, and inside the tx compare it to the current row; on mismatch throw a
typed `StaleEditError` and have the UI surface "This story changed since you opened the
editor — reload and re-apply." If we choose not to build the guard in this unit, **defer it
explicitly** as a documented follow-up (extend the existing prose-provenance follow-up
memory), rather than leaving it unstated. Either way the audit ledger is never corrupted —
staleness costs a clobbered live prose, not a lost provenance record.

## Plan (TDD)

Tests first, in order.

1. **Read** `story-repository.ts` `saveProseCorrection` (~L1414) and `logPolish` (~L1332),
   `schema.ts` `proseRevisionLevelEnum` (L149) + `storyStateEnum` (L62), and
   `invariants.sql` prose-revision guard (L59). Confirm no new enum value is needed.
2. **Core test — owner edits a `shared` story** (`packages/core/test/...`, PGlite): seed a
   story in `shared` state owned by P1; call `editStoryProse(db, {storyId, prose:"new",
   actorPersonId: P1})`; assert `stories.prose === "new"` and state is **still** `shared`.
3. **Core test — audit row appended:** after step 2, `listProseRevisions(db, storyId)` ends
   with a `human_corrected` row whose `text === "new"`, `actorPersonId === P1`,
   `modelId`/`promptText`/`storyRecordingId` all null.
4. **Core test — non-owner rejected:** call with `actorPersonId = P2` (not owner) → rejects
   with `InvariantViolation`; assert `stories.prose` **unchanged** and no revision appended.
5. **Core test — transcript/audio untouched:** seed a story with a transcript + a
   `story_recordings` row; after `editStoryProse`, assert `stories.transcript` and the
   recording rows are byte-identical to before.
6. **Core test — allowed across states:** parametrize over `draft`/`pending_approval`/
   `approved`/`shared`; all succeed for the owner. (Optionally assert the trimmed no-op does
   not append a whitespace-only revision.)
7. *(If building the concurrency guard)* **Core test — stale edit rejected:** pass an
   `expectedUpdatedAt` older than current → `StaleEditError`; prose unchanged.
8. **Implement** `editStoryProse` + export it from `index.ts`.
9. **Web action test** (`apps/web/__tests__/...`): the `editStoryProse` server action
   re-reads `getRuntime()` + `getCurrentAuthContext()` server-side, ignores any client
   `personId`, calls the core fn with `actorPersonId` from the auth context, and
   `revalidatePath`s the story route. Assert a non-owner / magic-link context is refused.
10. **Wire UI:** add "Edit story" to `OwnerActionMenu`; on the read surface
    (`page.tsx` region around L222 where `StoryReadBody` renders) add an edit-mode toggle
    that swaps `StoryReadBody` → `KindredProseEditor` (`value` = current prose,
    `onChange` local state, Save → action, Cancel → discard). Do **not** wire `onPolish`
    here unless desired — a plain edit needs no AI. Keep `KindredProseEditor`'s props as-is.
11. **Regression test (project rule):** the non-owner-rejected core test (step 4) + the
    transcript-untouched test (step 5) are the regression guards — they pin the two things
    most likely to silently break (authz widening, transcript clobber). Keep both.
12. **Green:** `pnpm --filter @chronicle/core test`, `pnpm --filter @chronicle/web
    typecheck test lint`, then `pnpm -r typecheck`.

## Done when

- [ ] `editStoryProse(db, {storyId, prose, actorPersonId})` exists in `story-repository.ts`,
      owner-gated, allowed in all four story states, appends one `human_corrected`
      `prose_revisions` row, and is exported from `@chronicle/core`.
- [ ] Transcript, `story_recordings`, and media are provably untouched by a prose edit.
- [ ] No migration (reuses `human_corrected`); no `consent_records`/`story_families` writes.
- [ ] Owner sees "Edit story" → editor prefilled → Save updates prose for the family; Cancel
      discards. Non-owner sees no affordance.
- [ ] Server action re-derives auth server-side and never trusts client `personId`.
- [ ] Concurrency guard built **or** explicitly deferred with a written follow-up note.
- [ ] Regression tests (non-owner rejected, transcript untouched) present and green;
      `pnpm -r typecheck` green.

## Shell fallback

This unit assumes Unit 01's `OwnerActionMenu` and the documented server-action convention.
If Unit 01 has not landed, do **not** rebuild the shell here — the core function
(`editStoryProse` + its tests) is fully independent and should still be built and merged;
the UI wiring (steps 9–10) blocks on the shell and can follow. If the shell arrives later,
mount the "Edit story" item then. Building the core write path first is the right ordering
regardless, since it is the thorny, high-value part.

## Adversarial notes

- **Silent divergence from consented text.** A reader may have read the shared prose;
  after an owner edit they'd see different words with no signal that it changed. We accept
  this per the locked "no re-consent" decision, but it is a real trust surface: the audit
  ledger records the change for *us*, not for *readers*. If product ever wants
  reader-visible "edited" affordances, the `prose_revisions` history already supports it —
  do not delete that lineage. This is the strongest argument for keeping the append-only
  audit non-negotiable.
- **No family notification.** Same root cause; explicitly out of scope. Flag it so a later
  "activity feed / edited badge" unit knows the data (revision rows + timestamps) is there.
- **Staleness / lost update.** Covered above. The failure mode is a clobbered *live* prose,
  never a corrupted ledger. Build the `updatedAt`/`seq` guard or file the deferral — do not
  leave it silent.
- **Two overlapping edit paths for `pending_approval`.** Both `saveProseCorrection` (owner,
  `pending_approval` only) and the new `editStoryProse` (owner, all states) can write prose
  + a `human_corrected` row for a `pending_approval` story. This is a latent footgun: two
  functions, same effect, one narrower. **Resolution to state in the doc/PR:** the composing
  surface (pre-approval review) continues to call `saveProseCorrection`; the post-share read
  surface calls `editStoryProse`. They are wired from different UIs and must not both be
  offered on the same screen. A future consolidation could collapse `saveProseCorrection`
  into `editStoryProse` (it would be a strict superset), but that is a separate refactor —
  do **not** delete `saveProseCorrection` in this unit (its `pending_approval`-only contract
  is depended on by the composing surface's tests). Note the redundancy so the consolidation
  is a deliberate future choice, not an accident.
- **Do not touch `assertStoryTransition`.** A prose edit is not a state transition; routing
  it through the state machine would be wrong and could reject a same-state "transition".
