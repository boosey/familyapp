# Continuation prompt — Clerk auth, Slice 2

Paste the block below into a fresh session to build Slice 2. It is self-contained.

---

You are implementing **Increment 9 — REAL CLERK AUTH, Slice 2 only** for Family Chronicle: the
magic-link path realized via **Clerk sign-in tokens (the `ticket` strategy)**. Slice 1 (the core Clerk
loop) is already built, gated green, and on the worktree branch `worktree-clerk-auth-slice1`. Read these
first, in order, then build:

- `docs/PLAN.md` → "Increment 9 — REAL CLERK AUTH" → **Slice 2** (the 4 tasks; Slice 1 is done/ticked).
- `docs/adr/0003-magic-link-is-a-passwordless-account-login.md` → §"Clerk implementation" (sign-in
  tokens vs Clerk's email-magic-link — the distinction is load-bearing; we use **sign-in tokens**).
- `docs/DECISIONS.md` → the Clerk entries.
- The Slice-1 code you build ON: `apps/web/lib/clerk-server.ts` (where `clerkClient()` lives),
  `apps/web/lib/auth.ts` / `auth-clerk.ts` / `auth-mock.ts` (the `establishAccountSession` seam),
  `apps/web/app/a/[token]/[askId]/route.ts` (the magic-link route that currently warm-degrades on Clerk),
  `apps/web/middleware.ts`, `apps/web/app/layout.tsx`.

## Scope — Slice 2 ONLY (PLAN.md Increment 9 Slice 2)
1. **`/a/[token]/[askId]` (Clerk path)** — mint `clerkClient().signInTokens.createSignInToken({ userId })`
   → redirect to the redemption route carrying the ticket + the final destination. Mock path unchanged.
2. **`/auth/redeem`** — a NEW **client** route: `signIn.create({ strategy: 'ticket', ticket })` (via the
   `useSignIn()` hook) → `setActive` → forward to the destination. Expired/invalid ticket warm-degrades
   to `/s/[token]`.
3. **Remove the throws-and-degrades branch** for the Clerk adapter's `establishAccountSession` seam
   (`auth-clerk.ts:83-95`) and the degrade branch in the `/a/[token]` route once the real path lands.
4. **Regression:** a ticket lands the correct Person on `/hub/answer/[askId]`; an expired/invalid ticket
   warm-degrades to `/s/[token]`.

## Hard constraints
- **GATE: prod Clerk keys (`sk_live_`/`pk_live_`) may go live ONLY after this slice lands AND is
  verified live.** Until then every "Sofia asked you a question" link would drop the narrator on the
  account-less `/s/[token]` surface instead of their hub. Dev/test keys only during the build.
- Preserve the dual-track design: keys-absent (CI/offline) must still run the mock cleanly. The mock
  `establishAccountSession` (cookie path) stays exactly as-is. Don't break `pnpm -r test` (no Clerk).
- Single front door intact: no new `@chronicle/db/content` / `.query.stories` access; architecture
  allowlist canaries unchanged. Clerk SDK imports stay in `apps/web` only.
- Use the context7 MCP tool to confirm the Clerk v6 client `useSignIn().signIn.create({strategy:'ticket'})`
  + `setActive` flow and `signInTokens.createSignInToken` before writing — the client redemption flow is
  the part most likely to have v5/v6 drift.

## Slice-1 discoveries that shape Slice 2 (verified during the Slice-1 build)
- **`establishAccountSession` seam.** The mock adapter implements it as a synchronous cookie-set
  (`auth-mock.ts:160-177`, resolves Person→Account `authProviderUserId`→session cookie). The **Clerk**
  adapter still THROWS "not supported in Phase 1" (`auth-clerk.ts:83-95`). The `/a/[token]` route catches
  that throw and warm-degrades to `/s/[token]` (`route.ts:64-81`). Slice 2's hard problem: Clerk forbids
  forging a server session from a `userId`, so the Clerk path can't be a `void`-returning cookie-setter.
  **Decide the seam shape:** either (a) branch the `/a/[token]` route on `isClerkConfigured()` —
  Clerk → mint+redirect to `/auth/redeem`, mock → `establishAccountSession` as today; or (b) widen the
  seam to return a discriminated result (`{kind:'cookie-set'}` vs `{kind:'redirect', url}`). ADR-0003
  favors keeping the method on `AuthProvider` but acknowledges the Clerk adapter "mints the ticket and
  hands off to the client redemption route." Pick one, document it, keep the mock path synchronous.
- **Person → Clerk userId reverse lookup.** Minting needs the Account's `authProviderUserId` (the Clerk
  userId) for a given Person. `findPersonIdByAuthProviderUserId` (in `@chronicle/core`) is the *forward*
  direction; you need the reverse (persons→accounts join, exactly what `auth-mock.establishAccountSession`
  already does at `auth-mock.ts:165-170`). Add a small core/lib helper or inline it.
- **Where `clerkClient` lives.** `apps/web/lib/clerk-server.ts`, reached via
  `await import("@clerk/nextjs/server")` then `const client = await clerkClient()` (v6: `clerkClient()` is
  **async**). Add a `mintSignInToken(userId)` helper there behind an **injectable seam** (mirror the
  existing `GetClerkUser` / `GetClerkUserIdByEmail` pattern) so the `/a/[token]` route test never touches
  real Clerk. `client.signInTokens.createSignInToken({ userId })` returns a `SignInToken` with `.token`.
- **`clerkClient()` works without middleware.** The `/a/[token]` route is EXCLUDED from the middleware
  matcher (it's a token surface), but minting uses the Clerk **Backend API** (secret key), which does NOT
  require `clerkMiddleware` to have run. So minting from `/a/[token]` is fine despite the carve-out.
- **The verified middleware matcher** (built + context7-verified in Slice 1):
  ```
  matcher: [
    "/((?!_next|s/|a/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ]
  ```
  Your new **`/auth/redeem`** route IS matched by entry 1 (good — the client `useSignIn` flow needs both
  the middleware and the `ClerkProvider`, which `layout.tsx` mounts when configured). Do NOT add `/auth/`
  to the carve-out. The `/s/` and `/a/` PAGE carve-out must stay. NOTE: `/api/media` is intentionally
  MATCHED (hub auth resolves Clerk `auth()` there) — do not "tidy" it into the carve-out; that breaks hub
  playback. (A Slice-1 review suggested carving it out; it was rejected for exactly this reason.)
- **The redeem destination.** A narrator using a magic link already HAS an Account+Person — no JIT
  provisioning needed. So `/auth/redeem` forwards straight to `/hub/answer/[askId]` (the dest passed from
  `/a/[token]`), NOT through `/auth/callback`. Carry the dest + the original `token` (for the warm-degrade
  fallback) in the redeem URL query.
- **How the dev Clerk instance is tested.** Slice 1 used injectable seams so unit tests never hit Clerk;
  **live acceptance was NOT run** (it is pending the dev Clerk keys — see below). The `/auth/redeem` client
  flow has no jsdom/RTL harness in `apps/web`, so its correctness will lean on **live** verification. Unit
  tests CAN cover: the `/a/[token]` route's Clerk-vs-mock branch (inject `mintSignInToken`), the reverse
  lookup, and the redeem URL construction (a pure helper). Factor those out so they're testable.
- **Clerk test users / OTP.** Dev Clerk test users use `+clerk_test@example.com` emails; the verification
  code is always `424242` (delivery bypassed). The Clerk-mode seed (`lib/dev-seed.ts`) binds personas by
  those emails. Eleanor (`eleanor+clerk_test@example.com`) is the narrator — the magic-link demo subject.

## Prerequisite the human must supply (same as Slice 1)
- Dev Clerk keys in `apps/web/.env.local` (`sk_test_`/`pk_test_`, NOT repo-root `.env`).
- Slice 0 done in the Clerk dashboard: **Name → required**; the `+clerk_test` test users created.
- These were NOT yet supplied at Slice-1 close, so Slice-1 live acceptance is also still outstanding —
  confirm BOTH slices' live acceptance on the same dev-Clerk session.

## Workflow (per CLAUDE.md — subagent-driven)
A coding sub-agent writes each task; when it finishes, spawn a **fresh cold adversarial code-reviewer**
sub-agent; the coder consumes the review and iterates until clean; spin up a new cold reviewer each round.

## Done = verified, then ship
Slice 2 is done when ALL hold:
- Gates green: `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @chronicle/web build`.
- **Live acceptance on the dev Clerk instance:** mint a sign-in token from `/a/[token]/[askId]` → redeem
  via `/auth/redeem` → land AUTHED on `/hub/answer/[askId]` as the right narrator; expired/invalid ticket
  warm-degrades to `/s/[token]`. State observed results with evidence — do not assert success unrun.
- Two adversarial cold-reviewer passes closed. Tick the Slice 2 boxes in `docs/PLAN.md`.
- **Only after the above:** the prod-keys gate is satisfied — going live with `sk_live_`/`pk_live_` is now
  permitted (still a deliberate, separately-confirmed step, not automatic).

## Build context
- Worktree: `C:\Users\boose\projects\familyapp\.claude\worktrees\clerk-auth-slice1` (branch
  `worktree-clerk-auth-slice1`), based on local `master` @ `87a5543`. Slice-1 changes are uncommitted
  there. Gate commands run from the worktree root. Slice-1 added tests:
  `apps/web/__tests__/{clerk-server,pending-invite,auth-callback,join-clerk}.test.ts` and Clerk-mode cases
  in `dev-seed.test.ts` / `auth-clerk.test.ts` (the middleware-matcher behavioral test lives in the latter).
