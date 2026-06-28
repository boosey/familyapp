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
