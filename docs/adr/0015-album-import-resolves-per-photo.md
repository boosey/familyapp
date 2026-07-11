# ADR-0015 — Album import resolves per photo, not per batch

Status: Accepted (2026-07-11)

## Context

Album import (file `upload` and the Google `google_picker`) needed visible progress: sized
placeholder tiles at the top of the grid that fill in as each photo lands, with per-photo failure and
retry. The pre-existing shape was a single batched server action (`uploadAlbumPhotoAction` /
`completeGooglePhotosImportAction`) that loops all files server-side and returns `{added, failed}`
counts. A batch can show N spinning placeholders, but they all resolve at once and a failure is a
count ("1 couldn't be added") with no way to say *which* tile or to retry just it.

## Decision

The client drives import as **one server-action call per photo**, run through a **bounded concurrency
pool** (default ≈3 in flight), so each placeholder tile resolves — or fails, with a tap-to-retry —
independently, and the UI shows a live "X of N". Google import is split into a **list-first** step
(returns the picked count + per-item handles) followed by per-item download+create, so Google reaches
the same exact-N placeholder UX as file upload (the count is otherwise unknowable until Google lists
the picked items). Placeholders render **in the real grid** via a shared client wrapper, driven by
explicit pending state merged into the grid (not raw `useOptimistic`, whose optimistic value is
discarded when the action's transition settles — racing the async `router.refresh()` and flickering).

## Considered options

**Batch v1** (one call, all files): simpler — one auth resolve, server-authoritative 30-cap, almost
no new code — but no live progress and no per-tile failure/retry. Rejected because the felt UX (live
count + per-photo retry) was the point of the feature.

## Consequences

- **The 30-item cap becomes a client-side UX/resource guard, not a security boundary.** Each per-item
  action still re-resolves auth and re-validates family membership server-side (identity and target
  are never trusted), so the worst a bypassed cap yields is an authenticated member adding more than
  30 of their *own* photos — annoying, not a breach.
- **Auth is re-resolved N times instead of once.** Because this multiplies the Clerk `auth()` path,
  the feature **ships gated behind the resolution of the current "Not signed in" auth bug** — enabling
  it beforehand would multiply that failure surface by N. The concurrency pool also caps the burst.
- Google per-item downloads pass `baseUrl` handles to the client, which passes each back to the
  per-item action. `baseUrl` is useless without the server-held access token, so this is a token-gated
  handle, not a credential leak — and it avoids N re-`list` calls (each with its FAILED_PRECONDITION
  retry).
