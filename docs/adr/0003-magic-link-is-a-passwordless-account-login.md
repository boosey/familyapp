# ADR-0003 — A capture/question link is a passwordless account login, not an account-less identity

Status: Accepted (2026-06-28)
Context: Phase 1 "complete the ask→answer→approve loop in the hub"; a narrator answers from a texted
link.

## Context

A narrator receives a text: "Sofia asked you a question." The link must (1) get her in without
typing a password and (2) drop her on the answer page for that specific question. Today a link
session token resolves to an account-less `link_session` identity used only on `/s/[token]`; the hub
authenticates separately via the account cookie (`{ kind: "account" }`). The in-hub
record→review→approve flow we are building runs entirely as `{ kind: "account" }`.

For a Person who **has an Account** (every seeded narrator does — "everyone has an account"),
arriving as an account-less `link_session` would mean every in-hub page has to handle two identity
kinds, and she never actually "logs in".

## Decision

**For a Person with an Account, the deep link is a magic-link login to that account.** The
deep-link route resolves the token → finds the Person → if the Person has an Account, establishes
the account session (sets the auth cookie via the configured provider — mock in dev, Clerk in prod)
→ redirects to `/hub/answer/[askId]`. If already signed in, it just routes. Past the front door,
everything is the one authenticated in-hub flow.

- The token grants **time-boxed, reusable** account access within its window (matching how link
  sessions resolve today), not strictly single-use — she can come back to finish.
- The account-less `link_session` path on `/s/[token]` **remains** for the genuinely no-account
  channel (telephony, or a narrator who never made an account). This decision only changes what
  happens when the resolved Person *has* an Account.

> **Note (2026-07-23):** The "telephony" example above is historical. Telephony capture was never
> built and has been removed as a planned channel; the account-less `link_session` path now serves
> only web narrators who never made an account.

## Consequences

- The texted token becomes a bearer credential for the whole account, not one scoped capture
  session — the standard magic-link trade-off (passwordless login ⇒ the link is the password).
  Accepted deliberately: a password-free path is the point for an elderly narrator.
- `@chronicle/capture` becomes identity-agnostic (separate change): `ingestRecording` /
  `captureApproval` accept `{ kind: "account"; personId } | { kind: "link_session"; token }`, so the
  in-hub flow reuses the one storage-first capture orchestrator. Core is untouched (already
  `personId`-based; `AuthContext` already has an `account` kind).
- Rejected: (a) mint a throwaway link session for a logged-in person (manufactures an account-less
  identity for someone who has an account — contradicts the glossary, litters `link_sessions`);
  (b) keep her on `link_session` in the hub (every page handles two identity kinds; she never
  "logs in").

## Clerk implementation (added 2026-06-29)

The domain **Magic link** above is realized under Clerk via **sign-in tokens (the `ticket`
strategy)** — NOT Clerk's "Email magic link" sign-in strategy. These are different things and the
distinction is load-bearing:

- **Clerk's Email magic link** is a *strategy where Clerk emails its own link to a Clerk-known
  address* and manages the round-trip. It cannot implement our flow: our link arrives via our own
  SMS/email carrying our own token, lands on our route `/a/[token]/[askId]`, and must convert that
  token into a Clerk session with no second Clerk email and no typing. (It also defaults to "require
  same device and browser," which would break the text-on-phone, open-on-phone reality — but we never
  route through it.)
- **Sign-in tokens** are the correct primitive: the `/a/[token]/[askId]` Route Handler resolves the
  token → Person → Account's Clerk `userId`, mints `clerkClient().signInTokens.createSignInToken({
  userId })`, then redirects to a small **client** redemption route (`/auth/redeem`) that calls
  `signIn.create({ strategy: 'ticket', ticket })` and forwards to `/hub/answer/[askId]`. Available via
  the Backend API regardless of any dashboard toggle.

Consequence for the seam: `establishAccountSession` stays a method on `AuthProvider`, but the Clerk
adapter can no longer implement it as a synchronous server "set cookie + redirect" (Clerk forbids
forging a session from a `userId` server-side). The Clerk path mints the ticket and hands off to the
client redemption route; the mock adapter keeps its synchronous cookie path. Until this lands, the
Clerk adapter throws and `/a/[token]/[askId]` warm-degrades to `/s/[token]` — so **prod Clerk keys
must not go live until the sign-in-token slice ships**, or every "Sofia asked you a question" link
drops the narrator onto the account-less surface instead of their hub.

Naming discipline: "Magic link" is the domain term (our texted deep link). The Clerk mechanism is
referred to as a "sign-in token / ticket," never "Clerk magic link," to keep the two from colliding.

### Update — implemented (2026-06-30, Increment 9 Slice 2)

The sign-in-token path is now built (all automated gates green; live acceptance on the dev Clerk
instance pending the Slice-0 dashboard prerequisite — see PLAN.md). Concrete shape:

- `establishAccountSession` was widened from `Promise<void>` to return a discriminated result
  (`{ kind: "established" } | { kind: "handoff"; ticket: string }`) — the method stays on
  `AuthProvider` as this ADR anticipated. Mock/dev set the cookie and return `established`; the Clerk
  adapter mints the ticket (`clerk-server.ts mintSignInToken` → `clerkClient().signInTokens
  .createSignInToken({ userId })`) and returns `handoff`. The reverse lookup Person → Clerk userId is
  `auth-clerk.ts resolveAuthProviderUserId`. (See DECISIONS.md for the full rationale + rejected
  route-branch alternative.)
- The `/a/[token]/[askId]` route is now provider-agnostic: it switches on the result kind via the
  pure `lib/magic-link.ts resolveMagicLinkTarget` and redirects either to the destination
  (`established`) or to `/auth/redeem?ticket=..&dest=..&token=..` (`handoff`). The old "Clerk adapter
  throws → warm-degrade" branch is gone; a genuine mint/DB failure still warm-degrades to `/s/[token]`.
- `/auth/redeem` is a client route (`useSignIn().signIn.create({ strategy: "ticket", ticket })` →
  `setActive` → hard-nav to the destination); an expired/invalid/used ticket warm-degrades to
  `/s/[token]`. Destinations are open-redirect-guarded (`safeInternalDest`) on both server and client.

Consequence for the prod-keys gate (still binding): prod `sk_live_`/`pk_live_` keys may go live only
after live acceptance of this slice on the dev instance passes.
