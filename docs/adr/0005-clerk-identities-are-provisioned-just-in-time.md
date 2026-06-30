# ADR-0005 — A new Clerk identity is provisioned just-in-time, not by webhook

Status: Accepted (2026-06-29)
Context: "Implement a real auth flow with Clerk" — turning on the production identity adapter
(`auth-clerk.ts`) so a real Clerk user becomes an Account + Person.

## Context

The Clerk seam was already scaffolded: `getCurrentAuthContext` resolves `Clerk session → userId →
Account → Person`, gated by `isClerkConfigured()`, with the mock provider as the dev/CI fallback. The
one thing missing is the **bridge**: when a brand-new user finishes Clerk sign-up, Clerk has a
`userId` but our DB has no `accounts` row and no `persons` row. Until `createAccountWithPerson` runs,
`getCurrentAuthContext` returns `anonymous` and the user is locked out of their own hub.

Two ways to create that first Account + Person:

- **Clerk `user.created` webhook** — Clerk POSTs to an endpoint; we provision there.
- **Just-in-time (JIT)** — on the first authenticated landing, if no Account exists for the `userId`,
  create it inline, then route.

## Decision

**Provision just-in-time, at a single post-authentication landing route (`/auth/callback`).** Clerk's
hosted `<SignUp/>`/`<SignIn/>` redirect there; the route reads `auth().userId`, looks up the Account,
and if absent calls `createAccountWithPerson` using the Clerk user's `firstName`/`lastName` (fetched
via `clerkClient().users.getUser()`) for `displayName`. It then applies any pending invite (see
ADR-0001 / the invitation flow) and hands off to `resolvePostAuthRoute`.

- **Name comes from Clerk** (the dashboard Name field is required), not from a placeholder. The
  glossary's "preferred spoken name" onboarding step is a separate, still-unbuilt improvement; it is
  not smuggled into auth. `spokenName` defaults to the first word of the Clerk name (existing
  `createAccountWithPerson` behavior) until that step lands.
- **Idempotent + race-safe.** `createAccountWithPerson` already rejects a duplicate
  `authProviderUserId` inside its transaction; the callback catches that and re-resolves, so two
  concurrent landings cannot fork an identity.
- `/auth/callback` is the **one** post-Clerk landing for every entry — plain sign-up, invitation
  accept, and (later) sign-in-token redemption all funnel through it.

## Consequences

- **No eventual-consistency gap.** Provisioning is synchronous with the redirect, so the first hub
  load never races an async webhook. A webhook would redirect the user into the app the instant
  sign-up finished, then intermittently resolve `anonymous` until the webhook fired — a broken first
  impression needing a "provisioning…" interstitial. JIT avoids the class entirely.
- **No webhook infrastructure** — no public endpoint, Svix signature verification, idempotency keys,
  or local tunnel to test. The whole loop is verifiable on a dev Clerk instance directly.
- **A write lives in a request path.** Mitigated by the in-transaction uniqueness guard; the write is
  confined to `/auth/callback`, never `getCurrentAuthContext` (a "read" must not silently write, and
  not every hub load should attempt a provision).
- Rejected: (a) **webhook** — eventual-consistency gap + standing infra for no benefit here, since the
  user is immediately interactive after sign-up; (b) **provision inside `getCurrentAuthContext`** —
  turns every authenticated read into a conditional write and spreads the write surface app-wide;
  (c) **placeholder name overwritten by onboarding** — onboarding does not currently write
  `displayName` (`completeOnboarding` sets only DOB + `onboardedAt`), so the placeholder would become
  permanent.
- A `user.created` webhook remains available as a **later backstop** for the abandon-before-landing
  edge case (user verifies email but never reaches `/auth/callback`). Not built now; noted so adding
  it is a deliberate choice.
