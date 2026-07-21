# Design: Email + SMS delivery for member invitations

**Date:** 2026-07-17
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `worktree-feat+invite-delivery-email-sms`

## Problem

Today an invitation is *generated* but never *sent*. `createInvitation`
(`packages/core/src/invitations.ts`) returns a raw token exactly once; the invite
tab (`apps/web/app/hub/tabs/InviteTab.tsx`) stashes it in a 60-second flash cookie
and shows a copy-link card. The inviter must manually forward the link. The
collected `inviteeEmail` is stored as a reference note only — nothing reads it to
deliver anything. There is no phone field and no email/SMS integration anywhere.

Goal: deliver the member-invite link to the invitee automatically by **email
(Resend)** and/or **SMS (Twilio)**, while keeping the copy-link card as a fallback.

## Decisions (from brainstorm)

| Decision | Choice | Notes |
|---|---|---|
| Channels | Email **and** SMS, both now | Resend + Twilio |
| Scope | **Member invite only** (`/join/[token]`) | Narrator `/s/` flow stays copy-only (deferred) |
| Trigger | **Auto-send + keep copy-link** | Belt-and-suspenders; link is the failure fallback |
| Execution | **Async via Inngest JobQueue** | Off the request path |
| Token handling | **Plaintext token in the Inngest job payload** | ⚠️ Accepted tradeoff — see Security below |
| Delivery status | Minimal status columns + most-recent-invite readout | Not a full audit log |
| SMS consent | Self-attest checkbox on the form | "I have permission to text this person" |

## Security tradeoff (explicit)

The invite's core invariant (`invitations.ts:6-7`) is: **the raw token is never
persisted — only its SHA-256 hash — so a DB leak cannot expose working invites.**
Inline sending preserves this (token lives only in request memory, then goes to the
delivery vendor). **Async delivery breaks it**: the worker runs after the request,
so the token must ride in the Inngest job payload, which Inngest persists durably
and surfaces in its dashboard/logs for the retention window.

The user chose to accept this: the plaintext token lives in the Inngest event store.
This is a deliberate, documented weakening of the never-persist invariant, recorded
in `docs/DECISIONS.md`. (Rejected alternatives: inline send — preserves the
invariant natively; envelope-encrypt the token in the payload — preserves
"leak ≠ working invite" at the cost of a crypto seam + key management.)

Mitigations we DO keep: short invite TTL (14 days, unchanged); the token is still
never written to our own DB; delivery is best-effort and idempotent per invitation.

## Architecture

### New package: `@chronicle/notifications`

Mirrors `@chronicle/storage`'s shape (interface + mocks in-package; vendor SDK only
in adapter files; architecture test forbids SDK imports elsewhere).

```
packages/notifications/
  package.json            # name @chronicle/notifications, main ./src/index.ts
  src/
    index.ts              # barrel: interface + types + mock + adapters
    contracts.ts          # Notifier interface + message/result types
    mock.ts               # MockNotifier (records sends; scriptable failure)
    resend.ts             # ResendEmailAdapter  (imports 'resend' — adapter carve-out)
    twilio.ts             # TwilioSmsAdapter    (imports 'twilio' — adapter carve-out)
  test/
    mock.test.ts
    resend.test.ts        # message → SDK call shape, no live vendor
    twilio.test.ts
```

Contract:

```ts
export type NotificationMessage =
  | { channel: "email"; to: string; subject: string; text: string; html?: string }
  | { channel: "sms";   to: string; text: string };

export type DeliveryResult =
  | { ok: true; providerId?: string }
  | { ok: false; error: string };

export interface Notifier {
  send(msg: NotificationMessage): Promise<DeliveryResult>;
}
```

- `MockNotifier` records every `send` and can be scripted to fail a given channel.
- Adapters translate a `NotificationMessage` to the vendor call and normalize the
  result. They are the ONLY files importing `resend` / `twilio`.
- The web runtime (`apps/web/lib/runtime.ts`) constructs the real adapters when the
  relevant env vars are present (`RESEND_API_KEY`, Twilio creds), else falls back to
  `MockNotifier` (dev/preview) — mirroring how Inngest degrades when unconfigured.

### JobQueue generalization (load-bearing)

The existing `JobQueue` (`packages/pipeline/src/contracts.ts`) is story-pipeline
specific: `JobName`/`JobPayload` are pipeline unions, the in-process impl dedupes by
`(name, storyId)` and caps attempts per `storyId`. Invite delivery has no `storyId`.

Plan: widen the seam minimally so it can carry an invite-delivery job.
- Add an `"invite.send"` job name and an invite payload
  `{ invitationId: string; token: string; channels: ("email"|"sms")[] }`.
- Generalize the in-process dedup/attempt key from `storyId` to a generic
  `dedupeKey` derived per job (invitations use `invitationId`); story jobs keep
  their current key. The Inngest adapter already dedups by a sha256 of the payload,
  so it needs only the new name/payload type.
- This keeps ONE queue seam rather than introducing a parallel one. The exact type
  shape is a shared contract fixed in the first (blocking) implementation task.

### Data model (migration `0020`, additive)

On `invitations` (`packages/db/src/schema.ts`):
- `inviteePhone text` — nullable, E.164, mirrors `inviteeEmail`.
- `deliveryChannels text[]` — channels requested at enqueue time (nullable/empty).
- `deliveredAt timestamptz` — set when at least one channel succeeds.
- `deliveryError text` — last error string when a channel fails (nullable).
- `deliveryAttempts integer not null default 0` — incremented by the worker.

These are mutable status fields (not an append-only ledger), written by the worker.
Migration is purely additive (`ADD COLUMN ... `), idempotent-safe. Regenerate the
snapshot (`schema.sql`) via `db:generate`; the drift guard bonds snapshot↔migration.

### Copy / templates

`apps/web/app/_copy/invitations.ts` (new namespace, added to `_copy/index.ts`
barrel): email subject + body and SMS body, as `as const` values / arrow fns for
the dynamic bits (inviter name, family name, link). No message text inline in code.

### Phone normalization

No helper exists today. Add `libphonenumber-js` and a pure `normalizePhone(raw,
defaultRegion)` util (in `@chronicle/notifications` or a small shared util) that
returns E.164 or `null` for invalid input. Unit-tested. The server action rejects an
invalid phone before creating the invitation.

## Flow

1. **Form** (`InviteTab.tsx`, member section): add a phone `<input>` (optional) and
   an SMS-consent checkbox shown/relevant when a phone is entered.
2. **Server action** `createMemberInvite`:
   - Validate + `normalizePhone` (invalid → reject; no invite created).
   - `createInvitation(...)` → `{ token }` (unchanged).
   - Determine channels: email if `inviteeEmail`, sms if normalized phone + consent.
   - Persist `inviteePhone` + `deliveryChannels` on the row (phone via a new field on
     `CreateInvitationInput`, or a follow-up update inside the same path).
   - If any channel: `queue.enqueue("invite.send", { invitationId, token, channels })`.
   - Set flash cookie (link fallback) + redirect with a `sent`/`sending` flag.
3. **Worker** (registered in `apps/web/app/api/inngest/route.ts` / runtime wiring):
   handler for `"invite.send"`:
   - Build `${APP_BASE_URL}/join/${token}` (reuse `resolvePublicOrigin`).
   - Render per-channel messages from the copy namespace.
   - `notifier.send(...)` for each requested channel.
   - Write `deliveredAt` / `deliveryError`, increment `deliveryAttempts` on the row.
   - Inngest native retry on throw; `onFailure` records terminal failure.
4. **Status readout**: after redirect, the result view shows the most-recent invite's
   delivery state (sending / delivered / failed) alongside the copy-link fallback.
   (A full "pending invitations" list is deferred.)

## Testing

- `normalizePhone`: valid / invalid / international / already-E.164.
- `MockNotifier`: records sends; failure scripting.
- Adapter mapping tests (`resend.ts`, `twilio.ts`): `NotificationMessage` → vendor
  call shape + result normalization, no live vendor.
- Worker + in-process queue + `MockNotifier`: composes correct email/SMS, writes
  delivered/failed status, increments attempts, respects retry/onFailure.
- Server action: enqueues when contact present, skips when absent, rejects invalid
  phone, records requested channels.
- **Architecture test** (`packages/pipeline/test/pipeline.test.ts`): add
  `packages/notifications/src` to the scanned roots and carve out `resend.ts` /
  `twilio.ts` as the only SDK-importing files.
- **Regression test** (per global rule): the outbound message body contains the
  correct `/join/<token>` link, and that token is one `acceptInvitation` accepts.
- Migration drift guard stays green (`db:generate` + `git diff --exit-code`).

## Out of scope / deferred (called out)

- Narrator-flow (`/s/[token]`) delivery.
- Rate-limiting / resend throttling — an inviter can currently re-send freely.
- Delivery webhooks (Resend bounce/complaint, Twilio delivery receipts) — we record
  our *send attempt*, not carrier-confirmed delivery.
- A2P 10DLC campaign registration — an ops prerequisite for real US SMS delivery;
  the code ships behind the seam regardless of registration status.
- Full "pending/sent invitations" management list.

## DECISIONS.md additions

- Resend = default `Notifier` (email) adapter; Twilio = default SMS adapter.
- Async invite delivery persists the plaintext token in the Inngest job payload — a
  deliberate, accepted weakening of the never-persist-token invariant.
