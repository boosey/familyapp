# Handoff — Album: Manage-Connections menu + per-item import progress

Status: designed & grilled 2026-07-11; **not yet implemented**. Design is locked (see below).
Authoritative decisions: `CONTEXT.md` § **Connection**, `docs/adr/0015-album-import-resolves-per-photo.md`,
and the revision note in `docs/adr/0009-story-imagery-album-topology.md`.

## Where the work happens
- Worktree: `.claude/worktrees/album-manage-connections-upload-progress`, branch
  `worktree-album-manage-connections-upload-progress` (branched from `origin/master`, which already
  includes commit `a764ecb`: the Google-picker poll fix + temporary `[DIAG]` auth logging).
- Deps already installed in the worktree.

## Feature 1 — "Manage connections" dropdown  (no rollout gate; ship anytime)
Replace the inline **Disconnect** button in `AlbumUploader.tsx` with a right-aligned
`Manage connections ▾` dropdown on the **same row as the import buttons**.
- **Disconnect-only.** The dropdown is shown **only when a Connection is active** (connected). The
  existing inline "Connect Google Photos" link stays for the not-connected state.
- Reuse the `OwnerActionMenu.tsx` mechanics (click-outside, Escape, `role="menu"`,
  `aria-haspopup`) — extract a small `ManageConnectionsMenu.tsx` if cleaner. Structure it so future
  sources add more Disconnect rows (Google is the only one now).
- The connected Google **email** moves out of the row into the menu as a header above its Disconnect item.
- **Single-tap** disconnect → calls the existing `disconnectGooglePhotosAction` → brief
  `Disconnecting…` pending state → refresh. No confirm step.
- Copy lives in `apps/web/app/_copy/hub.ts` (`googlePhotosDisconnect` exists; add a "Manage
  connections" label + any menu header copy).

## Feature 2 — In-grid per-item import progress  (GATED — see rollout gate)
Placeholder tiles at the **top of the real album grid** that fill in as each photo lands.
- **Rendering:** a shared client wrapper (e.g. `AlbumBoard.tsx`) mounted by the server component
  `AlbumSurface.tsx`, holding both the uploader controls and `AlbumGrid`. Drive placeholders with
  **explicit pending state merged into the grid**, NOT raw `useOptimistic` (its optimistic value is
  dropped when the action's transition settles, racing the async `router.refresh()` → flicker).
  `AlbumGrid.tsx` renders pending tiles (by `tempId`) before the real photos.
- **Exact-N both sources.** Upload: `N = files.length`. Google: **split** the import —
  a list-first action returns the picked count + per-item handles, then per-item download+create.
- **Per-item resolution through a bounded concurrency pool (~3 in flight).** Each tile resolves —
  or fails with a tap-to-retry mark — independently; UI shows a live "X of N". Tiles resolve out of
  order, keyed by `tempId`; the counter increments on each settle.
- **Cap:** client still enforces `MAX_BATCH_FILES = 30`. Each per-item action re-resolves auth and
  re-validates family membership server-side (identity/target never trusted); the cap is a
  UX/resource guard, not a security boundary.
- **Per-file prepare** (`prepare-photo.ts` downscale/HEIC guard) still runs before each upload call;
  a prepare failure marks that tile failed without aborting the others.

### Server-action changes (F2)
- `apps/web/app/hub/album/actions.ts`: add a single-file `uploadOneAlbumPhotoAction` (the current
  batched `uploadAlbumPhotoAction` can stay for fallback/tests or be retired). Keep the temporary
  `[DIAG album/upload]` logging until the auth bug is closed.
- `apps/web/app/hub/album/google-photos-actions.ts`: split `completeGooglePhotosImportAction` into
  `listGooglePhotosImportAction(sessionId)` → `{ count, items: handles, skipped, rejected }` and
  `importOneGooglePhotoAction(handle, familyIds)`. Picker primitives already exist in
  `packages/photos-google/src/picker.ts` (`listPickedPhotos`, `downloadPickedPhoto`).
  Pass `baseUrl` in the client-facing handle — it is token-gated (useless without the server-held
  access token), which avoids N re-`list` calls. See ADR-0015 Consequences.

## Rollout gate (critical)
F2 multiplies the Clerk `auth()` path by N. There is an **open "Not signed in" auth bug** under
active diagnosis: commit `a764ecb` added `[DIAG auth-clerk]` / `[DIAG album/upload]` logging to prod
and we are waiting on the user to do one upload + one import so we can read which anonymous branch
fires. **Do not enable F2 in production until that bug is confirmed dead.** Build F2 behind a flag
(env or a simple const) so it can land dark. F1 has no such gate.

## Workflow & verification
- Subagent-driven per `CLAUDE.md`: a coding subagent writes each feature; spawn a **fresh cold
  code-reviewer** subagent per feature; iterate to clean. Shared contracts (the per-item handle shape,
  pending-tile type) first, before parallel client/server work.
- TDD + a companion regression test per fix. Component tests: `apps/web/__tests__/album-uploader.test.tsx`,
  add coverage for the Manage-connections menu and placeholder rendering. Server:
  `apps/web/__tests__/album.server.test.ts` for the new single-item + list-first actions.
- Verify before claiming done:
  `pnpm --filter @chronicle/web typecheck && pnpm --filter @chronicle/web test`
  and `pnpm --filter @chronicle/photos-google test`; ideally `pnpm -r typecheck`.

## Do NOT
- Do not send an access token or a re-usable credential to the client (baseUrl handles only).
- Do not remove the server-side auth + membership re-validation on the per-item path.
- Do not enable F2 in prod before the auth bug is closed.
