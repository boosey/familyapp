# Continuation prompt — Clerk auth, Slice 1

Paste the block below into a fresh session to build Slice 1. It is self-contained.

---

You are implementing **Increment 9 — REAL CLERK AUTH, Slice 1 only** for Family Chronicle.
Read these first, in order, then build:

- `docs/PLAN.md` → "Increment 9 — REAL CLERK AUTH" (the task checklist; build **Slice 1**, NOT Slice 2)
- `docs/adr/0005-clerk-identities-are-provisioned-just-in-time.md` (JIT provisioning — the core design)
- `docs/adr/0003-magic-link-is-a-passwordless-account-login.md` → §"Clerk implementation" (context only;
  the sign-in-token work is Slice 2 — do NOT build it now)
- `docs/DECISIONS.md` → the Clerk entries (dev-runs-Clerk, Clerk-mode seed, magic-link mechanism)
- The existing seam: `apps/web/lib/{auth.ts,auth-clerk.ts,auth-mock.ts,clerk-config.ts,runtime.ts}`,
  `apps/web/middleware.ts`, `apps/web/app/layout.tsx`, `apps/web/app/{sign-in,sign-up,join/[token]}/`,
  `apps/web/lib/post-auth-route.ts`, `packages/core/src/accounts.ts`.

## Scope — Slice 1 ONLY (the 7 tasks + regression in PLAN.md)
1. Env wiring (`apps/web/.env.local`); confirm `isClerkConfigured()` flips to the Clerk adapter.
2. `/sign-in` + `/sign-up` → optional catch-all, conditional Clerk-component-vs-mock render,
   `forceRedirectUrl → /auth/callback`.
3. `/auth/callback` — JIT provision (idempotent) + pending-invite apply + `resolvePostAuthRoute`.
4. Middleware matcher — **verify against the Clerk v6 docs (use context7) before editing**; broaden for
   `/__clerk/:path*` + auth routes; keep `/s/[token]` and `/a/[token]` excluded.
5. `/join/[token]` rework — pending-invite cookie → Clerk sign-up → callback accepts; preserve the
   already-signed-in direct-accept path; relationship label stays collected up front.
6. Custom Kindred sign-out control (Clerk `useClerk().signOut()` vs mock server action). No `<UserButton/>`.
7. Clerk-mode seed — bind personas to real Clerk users by email query; skip-with-warning if unmatched.
   NOTE: the seed personas use `@example.test` emails, which CANNOT receive a Clerk OTP. The dev Clerk
   test users are created with the `+clerk_test@example.com` convention (Clerk dev instances bypass
   delivery; the verification code is always `424242`). So the Clerk-mode seed must query/bind by the
   `+clerk_test` emails — either change the persona emails to that form, or map persona → clerk_test
   email. Personas: Eleanor Boudreaux (`eleanor+clerk_test@example.com`), Sofia Boudreaux
   (`sofia+clerk_test@example.com`), Marco Boudreaux (`marco+clerk_test@example.com`), Theo Marchetti
   (`theo+clerk_test@example.com`). Eleanor is the narrator (the primary demo subject).
8. Companion regression tests (per the global "regression test after bug fix / feature" preference).

## Hard constraints
- **Do NOT build Slice 2** (magic-link / sign-in tokens). `establishAccountSession` keeps throwing on the
  Clerk adapter for now; the `/a/[token]/[askId]` warm-degrade stays as-is.
- **Do NOT enable prod Clerk keys.** Dev/test keys only.
- Preserve the dual-track design: keys-absent (CI/offline) must still run the mock cleanly. Don't break
  `pnpm -r test` (PGlite, no Clerk).
- Keep the single-front-door architecture intact: no new `@chronicle/db/content` or `.query.stories`
  access; the architecture allowlist canaries must stay unchanged.
- Don't run `clerk init` — it would clobber the hand-built conditional seam (middleware/layout/routes).

## Workflow (per CLAUDE.md — subagent-driven)
A coding sub-agent writes each task; when it finishes, spawn a **fresh cold adversarial code-reviewer**
sub-agent; the coder consumes the review and iterates until clean; spin up a new cold reviewer each round.

## Done = verified, then hand off
Slice 1 is done when ALL hold:
- Gates green: `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @chronicle/web build`.
- **Live acceptance on the dev Clerk instance:** sign up a fresh Clerk user → `/auth/callback` provisions
  Account+Person → `/welcome` → DOB → `/hub`. Then: accept an invitation as a new user end-to-end. Then:
  Clerk-mode seed → sign in as real-Clerk-Sofia → land in her seeded hub. Then: sign out. State the
  observed results, with evidence — do not assert success without running it.
- Two adversarial cold-reviewer passes closed.
- Tick the Slice 1 boxes in `docs/PLAN.md`.

**Then PAUSE. Do not start Slice 2.** Instead, write a new continuation prompt to
`docs/superpowers/plans/2026-06-29-clerk-auth-slice2-handoff.md` (same shape as this file) that instructs
a fresh session to build **Slice 2 — magic-link via Clerk sign-in tokens** per PLAN.md Increment 9, with
the gate that **prod Clerk keys may go live only after Slice 2 lands and is verified**. Capture in it any
Slice-1 discoveries that affect Slice 2 (the real shape of `establishAccountSession`/`/a/[token]`,
the verified middleware matcher, where `clerkClient` is imported, how the dev Clerk instance is tested).
Report back with the acceptance evidence and the path to the Slice 2 handoff. Stop there.
