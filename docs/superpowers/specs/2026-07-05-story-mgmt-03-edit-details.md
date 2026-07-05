# Unit 03 — Edit title & tags

**Prerequisite:** Unit 01 (Story Action Shell) — this unit is a menu item on the owner-only
`OwnerActionMenu` and follows Unit 01's documented server-action convention.
**Migration:** none. **Blast radius:** one new core write fn + its export, one new server action,
one edit-form client component, and the mount point in the story detail page.

## Purpose

Let a story's **OWNER** correct the title and freeform tags at any point in the story's life —
including after it is `shared`/consented. Today the only paths that write `title`/`tags` are either
the **ungated pipeline seam** (`updateDerivedFields`) or **pre-approval-only** owner functions
(`finishDraft`, `saveProseCorrection`). Neither is safe to expose to a post-share edit affordance:
one has no owner check, the others refuse any state past `pending_approval`. This unit adds ONE
narrow, owner-gated core function that works on any owner-owned story regardless of state.

**Locked decision:** editing a shared/consented story is FREE — no re-consent. Consent governs *who
the story is shared with*, not a text freeze; the family already agreed to see this story, and a
typo fix does not change that agreement. BUT every edit appends a `prose_revisions` audit row so the
change is attributable and reversible-by-inspection. Tags are **owner-only** (unlike prose
corrections, which in principle a co-author could make — here tags are the owner's shelving system).

## Spec

### Behavior (UI)

- **Owner path:** detail-page kebab (`OwnerActionMenu`, Unit 01) → **"Edit details"** menu item →
  opens an **inline in-DOM edit form** (NOT a route change, NOT a browser dialog) pre-filled with
  the story's current `title` and `tags`:
  - Title: a single-line text input, pre-filled with `story.title` (empty when untitled).
  - Tags: a chip editor — existing tags render as removable chips; a text input adds a new chip on
    Enter/comma; each chip has a remove (×) control.
  - **Save** → server action → `editStoryDetails` → `revalidatePath` the detail page → form closes,
    page shows new title/tags. **Cancel** discards all edits and closes the form (no write).
- **Non-owner path:** the menu never renders for non-owners (Unit 01 guarantees this via
  `isOwner`), so there is no affordance at all. This is defense-in-depth #1; the core owner check is
  the authoritative guard.
- **No native dialogs.** Per Unit 01, `window.confirm`/`alert`/`prompt` are forbidden (they block
  the page and freeze browser-automation review). The edit form is in-DOM.

### Read surface it edits

`apps/web/app/hub/stories/[id]/page.tsx` (`StoryDetailPage`, server component). Title renders at
~lines 164–175 (`{story.title ?? hub.stories.untitled}`); freeform `story.tags` render as neutral
outlined pills at ~lines 177–194 (distinct from the family-target pills that follow at ~195+). The
edit form is mounted in/near the `OwnerActionMenu` in the header region; on successful save the
server component re-renders with the new values (no client-side optimistic state needed beyond
closing the form).

### Authorization

Two layers, mirroring Unit 01's convention:

1. **Server action** (`"use server"`, colocated `actions.ts` on the route — same file family as
   `apps/web/app/hub/answer/[askId]/actions.ts`) re-reads `getRuntime()` +
   `getCurrentAuthContext()` **server-side**. It never trusts a client-supplied `personId`. It
   passes `ctx.personId` (only for `ctx.kind === "account"`) into the core fn.
2. **Core fn** independently re-checks `ctx.personId === story.ownerPersonId` and throws
   `InvariantViolation` otherwise. This is authoritative — the server action is belt-and-suspenders.

A magic-link / non-account viewer has no owner identity; the action rejects before calling core when
`ctx.kind !== "account"`.

### The new core function

Add to `packages/core/src/story-repository.ts` (already on the architecture allowlist — do NOT add a
new file to the allowlist for this). Export it from `packages/core/src/index.ts`.

```ts
export interface EditStoryDetailsInput {
  storyId: string;
  /** The editor — MUST equal story.ownerPersonId. */
  actorPersonId: string;
  /** New title. Trimmed; must be non-empty after trim. */
  title: string;
  /** New freeform tags. Normalized (see rules below) before persist. */
  tags: string[];
}

export async function editStoryDetails(
  db: Database,
  input: EditStoryDetailsInput,
): Promise<Story>;
```

Semantics (mirrors the `finishDraft` / `saveProseCorrection` owner-check + append idiom, but with
**no state gate**):

1. Open a `db.transaction`.
2. `SELECT ownerPersonId, state, prose FROM stories WHERE id = storyId LIMIT 1`. Missing → throw
   `InvariantViolation` ("story not found").
3. **Owner check:** `current.ownerPersonId !== input.actorPersonId` → throw `InvariantViolation`
   ("actor … is not the owner of story …"). **NO state check** — this is the whole point; the fn
   works on `draft` through `shared`.
4. Normalize `title` (trim) and `tags` (see rules). Reject empty-after-trim title with
   `InvariantViolation` ("title must be non-empty"). Reject tag-rule violations similarly.
5. `UPDATE stories SET title = <trimmed>, tags = <normalized>, updatedAt = now WHERE id = storyId`.
6. **Append one audit row** to `prose_revisions` (see revision-kind note) recording the edit.
7. Return the updated `Story`.

Do **not** reuse `updateDerivedFields` from the UI: it has no owner check and is the pipeline's
system-actor seam. `editStoryDetails` is the user-facing, owner-gated equivalent for the two
human-editable metadata columns only (it must never touch `transcript`/`prose`/`recording`).

### Tag normalization rules (stated defaults)

Applied server-side in the core fn — never trust the client's list:

- **Trim** each tag (leading/trailing whitespace).
- **Drop empties** (tags that are empty after trim).
- **Dedupe**, case-sensitive exact match, preserving first-occurrence order.
- **Max 12 tags.** Over the limit → `InvariantViolation` (the chip editor prevents reaching it, so
  this is a guard, not the primary UX).
- **Max 40 chars per tag** (after trim). Over the limit → `InvariantViolation`.
- Result is written to `stories.tags` (`jsonb`, `$type<string[]>`, default `'[]'`). An empty array is
  legal (owner cleared all tags).

These numbers are deliberately generous but bounded; they exist to stop pathological input, not to
constrain normal shelving. Adjust in one place (the core fn) if product wants different caps.

### Revision-kind value used

The `prose_revision_level` pgEnum (schema.ts ~149–156) is exactly:
`user_authored | ai_transcribed | ai_cleaned | ai_polished | human_corrected | ai_verified`. There is
**no** `human_metadata_edit` value, and inventing one would violate the enum/CHECK and fail the
insert. So the audit row uses **`level: "human_corrected"`** — the only human-authored provenance
level — with `actorPersonId = input.actorPersonId`, `modelId = null`, `promptText = null`,
`storyRecordingId = null`. This matches how `saveProseCorrection` writes its human edit.

Because `prose_revisions.text` is `NOT NULL` and by convention holds a **full prose snapshot**, and a
title/tag edit does **not** change prose, the audit row stores the story's **current (unchanged)
prose** (the `prose` selected in step 2; `""` if prose is null). This keeps the lineage a valid
sequence of full-prose snapshots and records "a human touched this story at time T" for provenance,
even though the change was metadata-only. This is a documented, mild semantic stretch — noted so a
future reader does not mistake the row for a prose rewrite. (Alternative considered and rejected:
adding a dedicated `human_metadata_edit` enum value — that IS a schema migration and enum change for
marginal provenance precision; out of scope for this unit. If metadata-edit auditing ever needs its
own analytics signal, promote it to its own enum value + migration then.)

The `prose_revisions` append-only trigger (`prose_revisions_append_only`, invariants.sql ~78–80)
blocks UPDATE always and DELETE unless consent-scoped — appending a new row is permitted and is the
correct, immutable way to record the edit.

### Data / no-migration note

**No schema change, no migration.** `stories.title` (`text`, nullable, schema.ts ~452) and
`stories.tags` (`jsonb $type<string[]>` default `'[]'`, schema.ts ~454) already exist. The audit row
reuses the existing `prose_revisions` table and the existing `human_corrected` enum value. Nothing
new is created; `db:generate` will emit no diff.

## Plan (TDD)

Tests first, in order:

1. **Read** `story-repository.ts` (`finishDraft` ~1259, `saveProseCorrection` ~1414, `logPolish`
   ~1332 for the owner-check + `prose_revisions` append idiom), `schema.ts` (the enum ~149, the
   `stories` columns ~452–454, `prose_revisions` ~540), and `page.tsx` ~150–195 for the title/tags
   render. Confirm no allowlist change is needed (staying inside `story-repository.ts`).
2. **Core fn test** (`packages/core/test/…`, PGlite, mirroring existing story-repository tests):
   - **Owner can edit a `shared` story** — approve+share a story, then `editStoryDetails` with a new
     title + tags succeeds and the returned `Story` reflects them (this is the load-bearing case:
     the existing owner fns would reject this state).
   - **Non-owner rejected** — a different `personId` throws `InvariantViolation`; the story is
     unchanged.
   - **Tags normalized** — input `["  Family ", "Family", "", "trip"]` persists as
     `["Family", "trip"]` (trim, dedupe, drop-empty); over-12 or over-40-char inputs throw.
   - **Empty title rejected** — `"   "` throws; story unchanged.
   - **Audit row appended** — after an edit, `listProseRevisions(db, storyId)` has one additional
     `human_corrected` row with `actorPersonId = owner`, `modelId = null`, and `text` equal to the
     (unchanged) prose snapshot. Editing again appends a second row (append-only, never mutates).
   - **Draft also editable** — the same fn works on a `draft` story (no state gate), sanity check.
3. **Implement** `editStoryDetails` in `story-repository.ts`; export from `index.ts` (add the fn name
   AND its `EditStoryDetailsInput` type to the `./story-repository` export block, ~22–61).
4. **Web action test** (`apps/web/__tests__/…`, the project's existing web test setup): the server
   action rejects a non-account context and a non-owner context without writing, and forwards
   `{ storyId, title, tags }` with the **server-derived** `personId` to core on the happy path
   (assert it does not read ownership/personId from its arguments). Mirror the answer-route action
   tests.
5. **Implement** the server action (`actions.ts` on the story route) + the inline edit-form client
   component; wire it as the "Edit details" item inside `OwnerActionMenu` (additive to Unit 01's
   props contract — pass current `title`/`tags` in). Confirm the detail page re-renders with new
   values after save.
6. **Regression test (project rule):** the "owner can edit a `shared` story + audit row appended"
   core test IS the companion regression guard for this unit's central risk — that a post-share edit
   is allowed, gated to the owner, and always leaves a provenance trail. Keep it named so it is
   obviously the regression anchor.
7. **Green:** `pnpm --filter @chronicle/core test`, then `pnpm --filter @chronicle/web typecheck test
   lint`, then `pnpm -r typecheck` to be safe.

## Done when

- [ ] `editStoryDetails(db, {storyId, actorPersonId, title, tags})` exists in `story-repository.ts`,
      owner-gated, **state-agnostic**, exported from `index.ts` (fn + input type).
- [ ] It updates only `title` + `tags` (+ `updatedAt`); never touches transcript/prose/recording.
- [ ] Tags normalized per the stated rules; empty title rejected; caps enforced server-side.
- [ ] Every successful edit appends exactly one immutable `prose_revisions` `human_corrected` row
      (unchanged-prose snapshot, `actorPersonId = owner`).
- [ ] Server action re-derives identity server-side; non-account / non-owner rejected before core.
- [ ] Inline in-DOM edit form (no native dialog); Cancel discards; Save revalidates the detail page.
- [ ] No migration (verified: `db:generate` emits no diff).
- [ ] Core test suite + `@chronicle/web typecheck test lint` + `pnpm -r typecheck` green; the
      shared-story-edit test is retained as the regression guard.

## Shell fallback

If Unit 01 (`OwnerActionMenu`) has not landed when this unit is built, do **not** rebuild the menu
here. Ship the core fn + server action + edit-form component (fully testable on their own), and mount
a temporary owner-only "Edit details" trigger inline in the header behind the same
`isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId` guard, matching Unit 01's
computation verbatim. When Unit 01 lands, move the trigger into the menu — the core fn, action, and
form component are unaffected. This keeps the units independently grabbable.

## Adversarial notes

- **Silent change to what family sees.** Editing the title of a `shared` story changes what every
  co-member sees on their next load, with **no notification and no re-consent**. This is *acceptable
  per the locked decision* (consent is about audience, not a text freeze), but it is a real
  information-flow property: a malicious or careless owner could materially rewrite the title/tags of
  a story others have already seen. We are NOT adding notification or re-consent in this unit; if
  product later wants "story was edited" surfacing, the `prose_revisions` trail this unit writes is
  exactly the data source for it. Flagging so the decision is a decision, not an oversight.
- **Scope creep guard.** The temptation is to also let this fn edit `summary`, `eraYear`,
  `eraLabel`, or `prose` "while we're here." Don't — prose edits are `saveProseCorrection`'s
  (pre-share, provenance-sensitive) territory, and widening this fn quietly re-creates the ungated
  `updateDerivedFields` we are deliberately not exposing. Keep it to `title` + `tags`.
- **TOCTOU between read-for-form and write.** The edit form is pre-filled from a snapshot read
  server-side at page render; by the time the owner saves, the story may have changed (e.g. a
  concurrent edit from another tab). `editStoryDetails` is a last-writer-wins full replace of
  title/tags (it does not diff against the form's original values). For a single-owner surface this
  is acceptable and matches the composing-surface precedent (`appendTypedTakeContribution` et al.
  are explicitly last-writer-wins). We do NOT add optimistic-concurrency versioning here; note it so
  a future multi-editor scenario knows this is unfenced.
- **`prose_revisions.text` semantic honesty.** Storing the unchanged prose in a `human_corrected`
  row for a metadata-only edit slightly overloads that level's meaning. The mitigation is
  documentation (this spec + a code comment on the insert). An analytics consumer that diffs
  consecutive `human_corrected` rows will see a zero-prose-delta row — that is the correct signal for
  "metadata-only edit," but it must be read as such, not as a no-op prose correction.
