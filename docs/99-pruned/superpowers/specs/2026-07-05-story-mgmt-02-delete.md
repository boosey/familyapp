# Unit 02 — Delete Story

**Prerequisite:** Unit 01 (`OwnerActionMenu` shell + server-action convention). See the *Shell fallback*
section if that unit hasn't landed yet.
**Migration:** none — the core path (`eraseStory`, `erasure_audit`, cascade token) already exists and is
already on the architecture allowlist.
**Blast radius:** the story detail page header (mount a menu item) + one new colocated `actions.ts` server
action + component/server tests. No schema, no core changes.

## Purpose

Give a story's **owner** a Delete affordance on the single-story read surface
(`apps/web/app/hub/stories/[id]/page.tsx`). This is a **hard delete** (ADR-0008 right-to-erasure): it works
on shared/consented stories, not just drafts. The core logic is done — this unit is UI wiring + a thin
server action that calls `eraseStory` and then reclaims the blob bytes.

Keep the surface tiny: one menu item, one in-DOM confirm, one server action, redirect to `/hub`.

## Spec

### Behavior

1. Owner opens the kebab (`OwnerActionMenu`) → a **"Delete story"** item, styled destructive (red/danger
   idiom from the Kindred system, not a new one).
2. Clicking it does **not** delete immediately. It reveals an **in-DOM two-step confirm** — either the item
   flips to "Confirm delete" / "Cancel" in place, or a small inline confirmation panel appears inside the
   menu. **No `window.confirm` / `window.alert` / native dialogs** — they block the page and freeze the
   browser-automation reviewer (same rule as Unit 01).
3. Confirming submits a form whose `action` is the server action (below). The submit control is disabled /
   shows a pending state while the action runs (`useFormStatus` or a local pending flag) so a double-click
   can't fire two deletes.
4. On success the server action `redirect`s to `/hub` (which unmounts this page entirely) after a
   `revalidatePath("/hub")`. On failure (`{allowed:false}`) it returns an error result that the client
   surfaces inline in the menu **without navigating** — the story stays on screen.
5. **Non-owner:** no Delete affordance at all. The whole `OwnerActionMenu` is owner-gated in Unit 01
   (`isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId`), so a non-owner never sees
   the item. This is the *first* line of defense only; the core check is authoritative (below).

### Authorization

- `eraseStory(db, ctx, {storyId})` (in `packages/core/src/erasure-repository.ts`) re-runs `decideManage`
  independently: allowed for the **owner** (`owner_erasure`) OR a **steward** of a family the story is
  targeted to (`steward_moderation`); denied (with a reason string) for anyone else, and for anonymous
  (magic-link) viewers.
- The server action re-reads `getRuntime()` + `getCurrentAuthContext()` on the server and passes the
  server-derived `ctx` straight into `eraseStory`. It **never** accepts a `personId` or ownership flag from
  the client — the only client input is the `storyId` (which `eraseStory` re-authorizes against anyway).
- **Owner vs. steward scope for THIS unit:** the kebab menu is owner-gated in Unit 01, so in this slice the
  Delete affordance is **owner-only in the UI**. `eraseStory` *would* also permit a steward, but a steward
  has no UI entry point here. **Documented gap / follow-up:** steward moderation-delete needs its own
  affordance (e.g. a steward-visible action on the family/moderation surface, or relaxing the menu gate to
  `isOwner || isSteward` with a distinct "Remove from family" label). Out of scope for Unit 02 — do not
  build it here, just leave the note. `eraseStory`'s steward branch stays covered by core tests.

### Storage cleanup

`eraseStory` returns `EraseResult = {allowed:false, reason} | {allowed:true, storageKeys: string[]}`. The DB
delete (row + consent ledger + audio media + `erasure_audit` row) happens transactionally **inside** the
core call. The returned `storageKeys` are the object-storage keys of the now-orphaned audio blobs — the
core call does **not** touch blob storage, so the server action must delete them **after** the core call
returns, best-effort, mirroring `discardAnswerAction` in
`apps/web/app/hub/answer/[askId]/actions.ts` (~line 872):

```ts
const { db, storage, auth } = await getRuntime();
// ...
const result = await eraseStory(db, ctx, { storyId });
if (!result.allowed) return { error: /* result.reason surfaced */ };
for (const key of result.storageKeys) {
  await storage.delete(key).catch(() => {}); // best-effort: a leaked blob is harmless; the DB row is gone
}
```

Rationale (same as `discardAnswerAction`): the DB row is already gone transactionally, so a leaked blob key
is harmless, whereas a throw here must not resurrect the story. Swallow per-key failures.

### Data

- No new tables/columns. `eraseStory` already appends the `erasure_audit` row (the fact-of-deletion that
  outlives the content) and is on the architecture allowlist — **no allowlist edit needed**.
- The action lives in a **new** `apps/web/app/hub/stories/[id]/actions.ts` (`"use server"`), colocated with
  the route, mirroring `apps/web/app/hub/answer/[askId]/actions.ts`. Return type mirrors the existing
  `ActionResult` shape (`{ error?: string }`) used there so the client can render a reason inline.

## Plan (TDD)

Write tests first (project rule: TDD + a companion regression test).

1. **Read** (ground everything before writing):
   - `packages/core/src/erasure-repository.ts` → `eraseStory` (return shape, authz, cascade).
   - `apps/web/app/hub/answer/[askId]/actions.ts` around `discardAnswerAction` (~872) for the
     `getRuntime()` → core call → best-effort `storage.delete(key).catch(()=>{})` idiom, and around the
     `redirect`/`revalidatePath` usage.
   - `apps/web/__tests__/finish-draft-action.server.test.ts` for the server-action test harness (the
     `vi.mock("@/lib/runtime", …)` pattern with settable `runtimeDb`/`runtimeStorage`/`authCtx`).
   - `apps/web/app/hub/stories/[id]/page.tsx` header region for where `OwnerActionMenu` mounts.

2. **Server-action test first** (`apps/web/__tests__/delete-story-action.server.test.ts`), mirroring the
   `finish-draft` harness with a real PGlite DB (`createTestDatabase`) + `InMemoryMediaStorage`:
   - **Owner delete removes story + storage keys (regression):** seed an owner + a story with an audio
     recording (so `storageKeys` is non-empty and the blob exists in `InMemoryMediaStorage`). Set
     `authCtx` to the owner. Call the action. Assert: `getStoryForViewer` now returns `null` (row gone);
     the storage keys are gone from `InMemoryMediaStorage`; an `erasure_audit` row exists. (Assert
     `redirect` via the thrown Next redirect signal or by mocking `next/navigation`.)
   - **Non-owner cannot delete (regression):** seed owner + story; set `authCtx` to a *different* account
     with no steward/family link; call the action with the owner's `storyId`. Assert: the story still
     resolves via `getStoryForViewer` for the owner; no `erasure_audit` row; the storage blob still
     exists; the action returns an error result (surfaced reason) and does **not** redirect.
   - **Idempotent / already-deleted:** delete once, then call again with the same `storyId`. Assert the
     second call returns `{allowed:false}`-derived error ("story … not found") gracefully — no throw, no
     redirect.
   - **Anonymous (magic-link) viewer:** `authCtx.kind !== "account"` → action returns the not-signed-in
     error without calling `eraseStory`.

3. **Implement** `apps/web/app/hub/stories/[id]/actions.ts` → `deleteStoryAction(formData)`:
   `beginLogContext()` (match the answer actions), `getRuntime()`, `getCurrentAuthContext()`, guard
   `ctx.kind === "account"`, read `storyId` from `formData` (validate non-empty string), call
   `eraseStory`, best-effort `storage.delete` loop, then `revalidatePath("/hub")` + `redirect("/hub")` on
   success; return `{ error }` on `!allowed` / invalid input / thrown error. Add `plog`/`plogError`
   observability lines to match the answer-actions idiom.

4. **Component test** (`apps/web/__tests__/…` React Testing Library) for the Delete menu item inside
   `OwnerActionMenu`: renders the destructive "Delete story" item for an owner; clicking it reveals the
   in-DOM confirm (Confirm/Cancel) and does **not** immediately submit; Cancel restores the plain item;
   there is **no** `window.confirm` call. (If Unit 01 exposes the menu-item as a child/prop, test at that
   seam; otherwise test the composed menu.)

5. **Wire** the Delete item + confirm form into `OwnerActionMenu` (client) and confirm the `formAction`
   points at `deleteStoryAction`. Pass `storyId` via a hidden input.

6. **Green gates:** `pnpm --filter @chronicle/web typecheck test lint`, then `pnpm -r typecheck` and
   `pnpm --filter @chronicle/core test` (confirm `eraseStory` core tests still pass — we didn't touch it).

7. **Regression guards kept:** the "non-owner cannot delete" and "owner delete removes story + storage
   keys" server tests from step 2 are the standing regression tests for this unit.

## Done when

- [ ] Owner sees a destructive "Delete story" item in the kebab; non-owner sees no menu at all.
- [ ] Confirm is **in-DOM** (two-step or inline panel); no `window.confirm`/`alert`/native dialog anywhere.
- [ ] `deleteStoryAction` re-derives `ctx` server-side, calls `eraseStory`, best-effort deletes every
      returned `storageKey`, then `revalidatePath("/hub")` + `redirect("/hub")`.
- [ ] `{allowed:false}` surfaces the reason inline without navigating.
- [ ] Deleting an already-deleted story fails gracefully (no throw, no redirect).
- [ ] Server tests cover: owner delete (row + blobs + audit), non-owner denied, idempotent re-delete,
      anonymous rejected. Component test covers the in-DOM confirm + no native dialog.
- [ ] `pnpm --filter @chronicle/web typecheck test lint` green; `pnpm -r typecheck` green;
      `pnpm --filter @chronicle/core test` still green.
- [ ] Steward-delete gap documented (not built).

## Shell fallback

If Unit 01's `OwnerActionMenu` hasn't landed, create the minimal contract inline rather than blocking:
a client component `apps/web/app/hub/stories/[id]/OwnerActionMenu.tsx` taking `{ storyId: string; isOwner:
boolean }`, rendering **nothing** when `!isOwner`, otherwise a labelled kebab `<button aria-haspopup="menu"
aria-label="Story options">` opening an in-DOM menu (Esc + click-outside close, no native dialog). Compute
`isOwner = ctx.kind === "account" && ctx.personId === story.ownerPersonId` in `page.tsx` and mount the menu
in the header region, passing only `storyId` + `isOwner` (never `ownerPersonId`) to the client. Keep it to
exactly what Delete needs so Unit 01, if it lands later, can absorb/extend it additively.

## Adversarial notes

- **Hard delete, not draft-discard.** Don't reach for `discardDraftStory` — it is draft-only and will refuse
  a consented/shared story. This unit must use `eraseStory`, which is the whole point (owners can delete
  stories they've already shared).
- **Order matters: DB first, blobs after.** Never delete blobs before `eraseStory` returns `allowed:true`.
  If you delete blobs first and the DB tx rolls back, you've orphaned audio on a live story. The core call
  is transactional and hands you the keys precisely so cleanup is a post-commit, best-effort step.
- **Don't trust the client `storyId` for authz.** It's fine to *pass* it — `eraseStory` re-authorizes the
  viewer against that exact story — but never derive "am I allowed" from anything the form posts. No
  `personId` from the client, ever.
- **Redirect after unmount.** `redirect("/hub")` throws a control-flow signal in Next server actions; make
  sure the `storage.delete` loop and `revalidatePath` run *before* it, and that the error path returns
  normally instead of redirecting (so the reason renders on the still-mounted page).
- **Double-submit.** The confirm button must be disabled/pending on submit; a second delete would hit the
  idempotent "not found" path (harmless) but the pending state avoids a confusing flash.
- **Steward temptation.** `eraseStory` allows stewards, and it'll be tempting to relax the menu gate "while
  I'm here." Don't — steward reach is a separate surface with a different label ("Remove from family" vs.
  "Delete story") and different mental model. Leave it as the documented follow-up.
- **`branch` tier / magic-link.** Non-account viewers have no owner identity; `ctx.kind === "account"`
  guards both the menu (Unit 01) and the action's first check. Confirm the action rejects them before
  touching the DB.
