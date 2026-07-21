# Issue #20 — Direct-to-storage (presigned) album uploads

**Problem.** Album photo bytes currently transit a Next.js Server Action. Two body caps sit in that path:
the Next.js Server-Action body limit (raised to `12mb` as an interim workaround) and, decisively,
Vercel's **~4.5 MB serverless request-body cap** — which no config can raise. Realistic multi-MB phone
photos and batches 413 in production. Fix: bytes go **client → object storage directly**; the server
only ever handles metadata.

**Decided design (see PR description for the fork the human chose).**

## Flow (per file, uniform across every environment)

1. `requestAlbumUploadAction({ contentType })` — server: re-auth, ensure ≥1 active family, validate
   `contentType` is an allowed image type, mint `family-photos/<uuid>` key, produce an **upload target**
   from the active `MediaStorage` adapter, mint a short-lived **HMAC upload ticket** binding
   `{ key, personId, exp }`. Returns `{ key, upload: { method, url, headers }, ticket }`.
2. Client `PUT`s the bytes straight to `upload.url` with `upload.headers` (+ `x-upload-ticket` header,
   ignored by R2, validated by the dev receiver).
3. `recordAlbumPhotoAction({ key, familyIds, ticket })` — server: re-auth, **validate the ticket**
   (HMAC ok, not expired, `personId === caller`, key matches), re-validate `familyIds` against the
   caller's OWN active memberships (authoritative placement, unchanged posture), confirm the object
   exists (`storage.exists(key)` — never record a phantom), read the **just-stored bytes**
   (`storage.getBytes`) and extract EXIF server-side (unchanged trust model), then `createAlbumPhoto`.

## MediaStorage change (all three adapters)

New interface method:
```ts
interface UploadTarget { method: "PUT"; url: string; headers: Record<string, string>; }
createUploadTarget(input: {
  key: string; contentType: string; expirySeconds?: number;
}): Promise<UploadTarget>;
```
- **R2**: `getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType, IfNoneMatch: "*" }),
  { expiresIn })`. Return the exact headers the client must send (`Content-Type`, `If-None-Match: *`).
  Write-once preserved. (If presigning `IfNoneMatch` proves incompatible with R2, drop it and rely on the
  fresh-UUID key — document the tradeoff; keep it if it works.)
- **Filesystem / In-Memory**: return a URL to a **dev-only receiver route**
  `POST/PUT /api/media-upload/[key]`. Adapters take an injected `uploadBaseUrl` (like `publicBaseUrl`);
  they do NOT know about Next routes beyond that base.

## Dev receiver route `apps/web/app/api/media-upload/[key]/route.ts`

- **404 in any durable/Vercel deploy** (reuse `isDurableDeploy` from runtime.ts) — it only exists so
  `next dev` exercises the exact prod shape. R2 presign URLs point at R2, never at this route.
- Requires an authenticated session AND a valid `x-upload-ticket`.
- Enforces the `family-photos/` keyspace and write-once (`storage.exists` → 409).
- Writes via `storage.put`.

## Security (acceptance criterion #2)

- Server mints the key; presign is scoped to that one key; short expiry (~90s); `IfNoneMatch: "*"`
  write-once → a client cannot overwrite arbitrary keys.
- `record` re-validates `familyIds` against the caller's memberships → cannot place into another
  family's album.
- HMAC ticket binds key→minter so `record`/dev-receiver cannot be driven with a forged or foreign key.

## Deletions / cleanup

- Delete `uploadAlbumPhotoAction` + `uploadOneAlbumPhotoAction` (body-transit).
- Remove `bodySizeLimit` from `next.config.mjs`; replace the comment with the direct-to-storage rationale.
- Client file **count** cap stays as a UX guard (ADR-0015: the cap was never a security boundary); the
  server no longer counts a batch. Drop the client **total-size** guard (transport limit is gone).

## Conventions

- New copy → `apps/web/app/_copy/hub.ts`. New numeric/string constants (expiry, allowed image types,
  client file cap) → `apps/web/lib/constants.ts` or a `@chronicle/storage` constant — single source.
- Update any architecture/guard test that asserts "`getUrl`/presign is never called in apps/web".

## Not verifiable here

Acceptance criterion #1 (a multi-MB batch succeeds in a real Vercel preview/prod deploy) **cannot** be
proven in this session — it needs real R2 credentials + a deploy. Tests assert the flow shape, security,
and EXIF-from-stored-bytes with in-memory/mocked storage. **HITL**: this changes a byte *write* surface
on the load-bearing single front door — human review + a real preview upload required before merge.
