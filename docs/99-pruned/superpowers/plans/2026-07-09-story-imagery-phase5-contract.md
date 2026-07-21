# ADR-0009 Phase 5 — Google Photos Picker import (connect-once) — SHARED CONTRACT

Locked product decision (2026-07-09): **connect once** (encrypted refresh token per Person) +
**Picker UI each import** + **Disconnect**. Not Image Search. Not silent Library browse.
Not strict-ephemeral re-consent. See `docs/DECISIONS.md` § Story imagery — Google Photos import.

Slice value: contributor imports photos they already own from Google Photos into a family album
without re-consenting every time.

Two sequential slices (coding-agent + fresh cold reviewer each):
- **Slice A:** schema + token vault + `@chronicle/photos-google` (OAuth + Picker, fetch-only) + tests.
- **Slice B:** web OAuth routes, import action, AlbumUploader Connect/Import/Disconnect UI + tests.

## Design decisions (LOCKED)

1. **Scope:** `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` only.
2. **Connect-once:** OAuth code exchange yields refresh token → AES-256-GCM encrypt → store in
   `google_photos_connections` (open schema, PK = `personId`). Access token minted on demand.
3. **Picker each import:** `sessions.create` → `pickerUri` → user picks → poll `mediaItemsSet` →
   `mediaItems.list` → download bytes via `mediaFile.baseUrl` (auth header) → copy into album.
4. **Videos skipped in v1:** only `type === "PHOTO"` (or image mime) imported; videos counted as
   `skipped` in the batch result (album is photos-only today).
5. **Source stamp:** `createAlbumPhoto(..., source: "google_picker")`. Same `family-photos/<uuid>`
   keyspace + EXIF extract as file upload.
6. **Vendor seam:** all Google HTTP in `@chronicle/photos-google` (fetch-only, injectable `fetch`).
   No Google SDK in `core`/`db`/`pipeline`/`capture`/`interviewer`/`storage`.
7. **Env gate:** `isGooglePhotosConfigured()` requires
   `GOOGLE_PHOTOS_CLIENT_ID` + `GOOGLE_PHOTOS_CLIENT_SECRET` + `GOOGLE_PHOTOS_TOKEN_ENCRYPTION_KEY`
   (32-byte key, base64). Unconfigured → Google buttons hidden (file upload only).
8. **OAuth state:** signed/httpOnly short-lived cookie (or encrypted state param) binding the
   OAuth round-trip to the signed-in Person — CSRF + account mix-up guard.
9. **Disconnect:** delete connection row (or set `revokedAt` + clear token) + best-effort Google
   token revoke. Next import requires Connect again.
10. **No content-allowlist change:** connection table is OPEN (like `link_sessions`).

## SLICE A — schema + adapter

### 1. Schema (`packages/db/src/schema.ts`)
```ts
export const googlePhotosConnections = pgTable("google_photos_connections", {
  personId: uuid("person_id").primaryKey().references(() => persons.id),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  googleAccountEmail: text("google_account_email"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
```
- Export from `schema-public.ts` + types from `index.ts`.
- `pnpm --filter @chronicle/db db:generate` (migration + snapshot). Drift guard green.

### 2. Token vault
`packages/photos-google/src/token-crypto.ts` (or `apps/web/lib/google-photos-crypto.ts`):
- `encryptToken(plaintext, keyBytes) → string` (AES-256-GCM, iv+tag+ciphertext, base64)
- `decryptToken(blob, keyBytes) → string`
- Key from env; never log plaintext/ciphertext.

### 3. Package `@chronicle/photos-google`
Fetch-only. Injectable `fetch`. Lazy env (throw on first use, not import).

Locked surface:
```ts
export interface GooglePhotosOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GooglePhotosConnection {
  refreshToken: string; // plaintext in memory only
  googleAccountEmail?: string | null;
}

/** Build the Google OAuth authorize URL (offline access, consent). */
export function buildAuthorizeUrl(cfg: GooglePhotosOAuthConfig, state: string): string;

/** Exchange authorization code → { refreshToken, accessToken?, email? }. */
export function exchangeAuthorizationCode(
  cfg: GooglePhotosOAuthConfig,
  code: string,
  opts?: { fetch?: typeof fetch },
): Promise<{ refreshToken: string; accessToken: string; email: string | null }>;

/** Refresh → short-lived access token. */
export function refreshAccessToken(
  cfg: GooglePhotosOAuthConfig,
  refreshToken: string,
  opts?: { fetch?: typeof fetch },
): Promise<{ accessToken: string; expiresIn?: number }>;

/** Best-effort revoke. */
export function revokeToken(token: string, opts?: { fetch?: typeof fetch }): Promise<void>;

export interface PickerSession {
  id: string;
  pickerUri: string;
  pollingConfig?: { pollInterval?: string; timeoutIn?: string };
}

export function createPickerSession(
  accessToken: string,
  opts?: { fetch?: typeof fetch },
): Promise<PickerSession>;

export function getPickerSession(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: typeof fetch },
): Promise<PickerSession & { mediaItemsSet: boolean }>;

export interface PickedPhoto {
  id: string;
  mimeType: string;
  filename: string | null;
  baseUrl: string;
}

/** List PHOTO items only (skip video). */
export function listPickedPhotos(
  accessToken: string,
  sessionId: string,
  opts?: { fetch?: typeof fetch },
): Promise<PickedPhoto[]>;

/** Download bytes from a picked item's baseUrl (Authorization: Bearer). */
export function downloadPickedPhoto(
  accessToken: string,
  item: PickedPhoto,
  opts?: { fetch?: typeof fetch },
): Promise<{ bytes: Uint8Array; contentType: string }>;

/** Deterministic mock for tests / unconfigured dev. */
export class ScriptedGooglePhotosClient { /* records calls; scripted responses */ }
```

API hosts (locked):
- OAuth: `https://oauth2.googleapis.com/token`, `https://accounts.google.com/o/oauth2/v2/auth`,
  `https://oauth2.googleapis.com/revoke`
- Picker: `https://photospicker.googleapis.com/v1/sessions`, `.../v1/mediaItems?sessionId=`

Unit tests with stubbed `fetch` (no live Google). Cover: authorize URL shape, code exchange,
refresh, create/get session, list photos (filters video), download, error mapping.

## SLICE B — web

### 4. Config + connection repo
- `apps/web/lib/google-photos-config.ts` — `isGooglePhotosConfigured()`, redirect URI helper.
- `apps/web/lib/google-photos-connection.ts` — upsert/getActive/disconnect against open table;
  encrypt/decrypt at boundary.

### 5. OAuth routes
- `GET /api/google-photos/connect` — account-authed; set state cookie; redirect to Google authorize.
- `GET /api/google-photos/callback` — validate state; exchange code; upsert connection; redirect
  `/hub?tab=album` (or `/hub/album`) with flash success/error.
- Disconnect: server action `disconnectGooglePhotosAction` (re-resolve auth).

### 6. Import flow
Two-step (server-driven; no Google SDK in browser):
1. `startGooglePhotosImportAction` → mint access token → `createPickerSession` → return
   `{ sessionId, pickerUri }` to client.
2. Client opens `pickerUri` (new tab / same window). Client polls
   `pollGooglePhotosImportAction(sessionId)` until `mediaItemsSet` (or timeout).
3. On ready: `completeGooglePhotosImportAction({ sessionId, familyIds })` → list photos →
   per photo: download → EXIF → `storage.put` → `createAlbumPhoto(..., source: "google_picker")`
   (same loop as `uploadAlbumPhotoAction`). Return `{ ok, added, failed, skipped }`.

Family-id validation identical to upload (intersect with active memberships).

### 7. Album UI (`AlbumUploader.tsx` / `AlbumSurface.tsx`)
When configured:
- Not connected → "Connect Google Photos"
- Connected → "Import from Google Photos" + "Disconnect"
When unconfigured → no Google chrome (file upload only).

Copy in `apps/web/app/_copy/hub.ts`.

### 8. Tests
- Adapter unit tests (Slice A).
- Web: connection upsert/disconnect; import happy path with `ScriptedGooglePhotosClient` /
  stubbed fetch injected via test seam; unconfigured hides path; IDOR (other person's session) denied.
- Keep album upload tests green. Architecture + vendor-SDK guards green.

## Explicitly OUT of scope
In-app Google gallery browse (Library API) · sync/watch · video import · Apple PhotoKit ·
storing Google access tokens long-term · Image Search / open-web images.

## Verify
`pnpm --filter @chronicle/db db:generate` · `pnpm --filter @chronicle/db test` ·
`pnpm --filter @chronicle/photos-google test` · `pnpm --filter @chronicle/web test` ·
`pnpm -r typecheck` · oxlint on touched files.
