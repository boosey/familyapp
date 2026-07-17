# Provider-Agnostic Identity — Design

Date: 2026-07-17
Status: Approved (design); implementation not started
Related: ADR-0003 (magic link), ADR-0005 (JIT provisioning), ADR-0016 (kinship), issue #10 (Clerk webhook sync)

## Problem

Identity is linked by an **exact match on the auth vendor's opaque user id** (`accounts.auth_provider_user_id`, unique). On any unseen id, `provisionOrResolveClerkUser` (`apps/web/lib/clerk-server.ts`) JIT-creates a fresh Account + Person. There is no email/contact fallback.

Consequences observed in production (2026-07-17):
- **Dev→prod duplicates.** Accounts created during dev/preview testing were written to the prod Neon branch but keyed to **dev-instance** Clerk ids. On go-live, signing into the **prod** Clerk instance mints a new id → matches nothing → a **duplicate empty Person**. Hit John Boudreaux (fixed by manual delete + repoint); Zachary Boudreaux is still exposed (has a real story).
- **Vendor lock-in.** All identity is keyed to Clerk's id space. Deleting/recreating a user in Clerk, or switching auth vendors, would orphan every login and force users to start over.

## Goals

1. Survive a vendor's id changing for the same human (Clerk deletion/recreation, dev→prod, **vendor switch**) without losing the account or its content.
2. Anchor identity on a **portable, provider-neutral, verified** identifier (email now; phone later) — the auth vendor becomes a swappable pointer.
3. Auto-heal the remaining dev-era accounts (Zachary) on next login — no per-user manual surgery.
4. Never weaken the security boundary: an **unverified** contact must never adopt an existing account (account-takeover vector, especially via password auth).

## Non-goals (v1)

- **Phone/SMS matching.** Schema accepts `kind = 'phone'`, but v1 match logic compares verified **emails** only. Flip on later with no migration.
- **Account merge.** The ambiguous "email matches account X, phone matches account Y" case only arises with phone matching → deferred with phone.
- **Pruning dead identity rows** (e.g. a healed account's old dev Clerk id) — harmless; optional later cleanup.
- **Person-erasure path** (kinship append-only carve-out) — separate deferred ADR-0016 gap; noted, not built here.

## Data model (additive migration `NNNN`)

Two new tables; `accounts` remains the durable spine (still owns `active`, profile mirror).

```
account_identities
  id                uuid pk default gen_random_uuid()
  account_id        uuid not null fk → accounts(id)
  provider          text not null        -- the auth VENDOR: 'clerk' (NOT 'google'/'sms')
  provider_user_id  text not null
  created_at        timestamptz not null default now()
  UNIQUE (provider, provider_user_id)

account_contacts
  id            uuid pk default gen_random_uuid()
  account_id    uuid not null fk → accounts(id)
  kind          text not null            -- 'email' | 'phone'  (phone accepted, inert in v1 logic)
  value         text not null            -- normalized: email lowercased + trimmed
  verified_at   timestamptz              -- NULL = unverified; NULL is NEVER a match key
  created_at    timestamptz not null default now()
  UNIQUE (kind, value)                   -- a contact value maps to at most one account
```

Design notes:
- `provider` is the **auth vendor**, not the social connection. Google / password / SMS *inside Clerk* all resolve to **one Clerk user id** → one identity row. A second identity row only appears on a **vendor switch** (Clerk → other) or the transient dev+prod overlap.
- `UNIQUE (kind, value)` is load-bearing: it guarantees a verified email can't fan out to two accounts, and makes the concurrent-attach race safe (loser trips the constraint, re-resolves the winner).
- `accounts.auth_provider_user_id` becomes **vestigial**: kept nullable for one release for rollback, dropped in a follow-up migration. `accounts.email` stays as the display/reconcile mirror (updated by the Clerk `user.updated` webhook).

### Backfill (same migration)

For every existing account:
- insert `account_identities(account_id, 'clerk', auth_provider_user_id)`
- insert `account_contacts(account_id, 'email', lower(trim(email)), verified_at = now())` when email is present

Existing users passed Clerk's verify-at-signup, so treating their email as verified is sound. This is what makes Zachary's existing account matchable by his email.

The contact insert uses `ON CONFLICT (kind, value) DO NOTHING` (keep the earliest account) so `UNIQUE(kind, value)` can't abort the migration if two accounts ever share an email. Post-cleanup all 8 prod emails are distinct, so nothing is dropped today — the guard is defensive. If a genuine duplicate-email pair is ever found, it must be reconciled (merge/delete) **before** this migration, not silently — the migration should `RAISE`/log rather than quietly drop the second, so surface it in the implementation plan.

## Resolution logic

`provisionOrResolveClerkUser` (`apps/web/lib/clerk-server.ts`) is rewritten to a 4-step engine. Input: `(vendor='clerk', vendorUserId, verifiedEmails[])` derived from the Clerk user object.

1. **Identity match** `(provider, provider_user_id)` → account → person. Fast path for existing users.
2. Else, any **verified** email matches an `account_contacts(kind='email')` row → **attach**: insert a new `account_identities` row for `(vendor, vendorUserId)`, merge any not-yet-stored verified contacts, return that account's person. *(re-link: heals dev→prod, Clerk deletion, vendor switch.)*
3. Else → create new account + identity + contacts (today's behavior, minus the id-only assumption).
4. An **unverified** email is never used in step 2 — falls through to step 3.

Race safety preserved: `attach`/`create` rely on the unique constraints; on a concurrent loser (InvariantViolation or raw 23505), re-resolve and return the winner's person.

### Code touched

- `apps/web/lib/clerk-server.ts` — rewrite `provisionOrResolveClerkUser`; extend `ClerkUserLite` to carry each email's `verification.status` and the full verified-email list.
- `apps/web/lib/auth-clerk.ts` — `resolvePersonRow` joins through `account_identities` (not `accounts.auth_provider_user_id`); `resolveAuthProviderUserId` (magic-link ticket mint) resolves the person's **clerk** identity from the table.
- `packages/core/src/accounts.ts` — add `resolveAccountByIdentity`, `resolveAccountByVerifiedEmail`, `attachIdentity`; `reconcileAccountProfile` / `deactivateAccountByAuthProviderUserId` key on `(provider, provider_user_id)`. `createAccountWithPerson` also writes the identity + contact rows atomically.
- `packages/db/src/schema.ts` — add the two tables; export types; regenerate snapshot + migration.
- Architecture test: the new tables are auth plumbing (not Story/Media content), so the content single-front-door allowlist is unaffected; the auth read-path files are already allowlisted for db access.

### Verified-flag source

Clerk's server user object exposes per-email `verification.status` (`EmailAddress.verification.status === 'verified'`). **To confirm against current Clerk docs during implementation** — this flag is the linchpin of the security gate. If a sign-in method could ever yield an email with a non-`verified` status, step 2 must skip it.

## Rollout

1. Additive migration (tables + backfill) runs in the Vercel build (`db:migrate`) against prod Neon.
2. Deploy the code that reads/writes the new tables.
3. Later migration drops `accounts.auth_provider_user_id` once stable.

Healing:
- **Zachary** — next prod login: step 1 misses (new prod id), step 2 matches his backfilled email contact → attaches the prod identity to his real account. Keeps his dev identity row (dead, harmless).
- **John** — already repointed; backfill just wraps his account in an identity + contact.

## Tests (TDD, security-first)

1. **Unverified email does NOT attach** — a login whose email status ≠ `verified` creates a **separate** account, never adopting an existing one. *(regression test for this whole bug class.)*
2. Known identity → fast-path to the existing person (no new rows).
3. New vendor id + verified matching email → attaches identity, resolves to the **same** person (the dev→prod heal).
4. Concurrent attach for the same new id → exactly one identity row, no forked person.
5. Backfill correctness + migration drift-guard stays green (snapshot ↔ migration chain bonded).
6. `UNIQUE (kind, value)` rejects a second account claiming the same verified email.

## Open questions

- Confirm Clerk server object's email `verification.status` field name/shape against current docs before writing step 2.
- Normalization for future phone (E.164) — deferred with phone matching.
