# Inline name (and DOB) capture in onboarding

**Date:** 2026-07-02
**Status:** Approved, ready for implementation plan

## Problem

On the live Clerk beta, a new user is never asked for their own name. Signing up
collects only email + password (the Clerk hosted sign-up form has no Name field),
so `provisionOrResolveClerkUser` derives `Person.displayName` via
`clerkDisplayName()` (`apps/web/lib/clerk-server.ts:110`), which silently falls
back to the **email local-part** ("First Last" → email local-part → "Family
member"). The user ends up named after their email prefix and is never prompted
to correct it.

DOB *is* asked in the `/welcome` step, which the family-first router
(`resolvePostAuthRoute`, Gate B: `onboarded_at IS NULL → /welcome`) reaches right
after a family is created/joined. But it can be skipped for accounts whose
`onboarded_at` was stamped in an earlier session (e.g. before the family-first
reorder, when DOB came first) — which is why the reporter landed straight on the
hub with no DOB screen.

**Root cause:** the person's own name is outsourced to Clerk's form config with a
silent email-prefix fallback; there is no in-app step that guarantees a real,
user-entered name.

## Goal

Every new account is asked for **their own name and DOB** in the in-app
`/welcome` onboarding step, in one flow, so a name is never silently derived from
the email prefix. Family-first ordering is preserved.

New flow for a manual signup:

```
Clerk sign-up (email + password)
  ↓  /auth/callback  (JIT provision — displayName is a temporary placeholder)
/families/start   (create or join a family)
  ↓
/welcome  →  YOUR NAME  →  YOUR DOB      (single onboarding flow)
  ↓
/hub/about-you (intake)  →  hub
```

`/welcome` is the universal onboarding funnel: both the create-family and
join-family paths pass through it (Gate B) before reaching the hub, so adding the
name step here covers every new account with one change.

## Design

### 1. `core/completeOnboarding` — persist identity + DOB atomically

`packages/core/src/onboarding.ts`

- Add a required `displayName: string` to `CompleteOnboardingInput`.
- Trim it; reject empty/whitespace with `InvariantViolation` (the same guard
  `createAccountWithPerson` already uses for `displayName`).
- The existing single `UPDATE persons` now also sets `displayName` and
  `spokenName` (derived: first whitespace-delimited word) alongside `birthDate`,
  `birthYear`, and `onboardedAt`. One atomic write means the `onboarded_at` gate
  stamp and the real name land together — there is no reachable state where a
  Person is past the `/welcome` gate without a user-entered name.
- Validation order: name check first (cheap, and the more fundamental
  precondition), then the existing calendar-date and not-in-the-future checks,
  then the write.

Re-onboarding overwrites the same fields (idempotent in shape), including
re-deriving `spokenName` from the newly entered name.

### 2. Shared `defaultSpokenName` helper

`packages/core/src/names.ts` (new)

`defaultSpokenName(displayName)` is currently a private function in
`accounts.ts`. Extract it to a tiny shared module and import it in both
`accounts.ts` and `onboarding.ts`, so the spoken-name rule ("first whitespace-
delimited word, else the trimmed whole") has a single definition. Behavior is
unchanged; this is a move + import, not a rewrite.

### 3. `/welcome` flow — insert a name step before DOB

`apps/web/app/welcome/WelcomeFlow.tsx`

- Step machine becomes `welcome → name → dob` (was `welcome → dob`).
- **Welcome intro** stops interpolating `firstName` (which today may be the email
  prefix) and uses a name-free greeting. The `invited` variant may keep an
  invited-specific eyebrow/message but must not depend on an unconfirmed name.
- **Name step:** a single text field ("What should we call you?"), Continue
  disabled until the trimmed value is non-empty. Initial value comes from the
  pre-fill helper (below). Mirrors the existing voice-stub + typed-field pattern
  used by the DOB step (voice control is a visible stub; the typed field is the
  real path).
- **DOB step:** unchanged UI. The final Continue now submits
  `{ displayName, year, month, day }` in one call; on success →
  `router.push("/hub/about-you")`.
- `firstName`/`invited` props: `firstName` is no longer used for the greeting;
  the component instead takes an `initialName` prop for the name field. `invited`
  is retained for the eyebrow/greeting variant.

### 4. Pre-fill helper

`apps/web/app/welcome/` (a pure, unit-tested helper — e.g. `onboarding-name.ts`)

```
initialOnboardingName(displayName: string, email: string): string
```

Returns `displayName`, **unless** `displayName` trimmed/case-folded equals the
email local-part (the fallback signal), in which case returns `""`. Effect:

- Real Clerk name ("Alex Boudreaux") → pre-filled, user just confirms.
- Email-prefix fallback ("alexboudreaux.dev") → blank field, user is forced to
  type a real name instead of silently accepting the prefix.

### 5. Server action

`apps/web/app/welcome/actions.ts`

`saveDob` becomes `completeAccountOnboarding(input: { displayName, year, month,
day })`: re-resolves the auth context server-side (client never passes a
personId), requires `ctx.kind === "account"`, delegates to `completeOnboarding`.
The web layer does no name/DOB validation itself — core owns it.

### 6. `welcome/page.tsx`

- Additionally read the account email (join `accounts` on `persons.accountId`) so
  the pre-fill helper can compare against the local-part. Identity-graph reads
  only (persons + accounts) — no content tables.
- Compute `initialName = initialOnboardingName(displayName, email)` and pass it
  to `WelcomeFlow`.
- Keep the existing "already onboarded → `resolvePostAuthRoute`" redirect guard
  (re-submitting would otherwise overwrite name/DOB/`onboarded_at`).

### 7. Copy

`apps/web/app/_copy/welcome.ts`

- Add name-step strings: title, body, field label, placeholder.
- Make the intro greeting name-free (drop `greetingNamed(firstName)` usage for
  the unconfirmed case; keep a generic and an invited variant).

## Testing

Regression tests accompany the fix (per project rule: regression test after a bug
fix).

- **`packages/core` onboarding tests:**
  - `completeOnboarding` persists `displayName` + derived `spokenName` + DOB +
    `onboardedAt` in one call.
  - Rejects empty and whitespace-only `displayName` with `InvariantViolation`,
    and does **not** stamp `onboarded_at` when it rejects.
  - Existing DOB validation (non-real calendar date, future date) still holds.
  - `spokenName` is re-derived from the entered `displayName` (e.g. "Alex
    Boudreaux" → "Alex").
- **`packages/core` names test:** `defaultSpokenName` behavior preserved after
  extraction (first word; single word; leading/trailing whitespace; empty).
- **`apps/web` unit test:** `initialOnboardingName` returns `""` when displayName
  equals the email local-part (case-insensitive, trimmed) and passes a real name
  through unchanged.
- Update any existing references to `saveDob` in tests to the new action name/
  signature.

## Out of scope (deliberate)

- **No backfill** of existing accounts. Single-schema dev, no real users yet. The
  reporter's own beta account already has `onboarded_at` set; to re-test they
  sign up as a fresh Clerk user or we null their `onboarded_at` out of band.
- **`clerkDisplayName` fallback unchanged.** It remains a temporary placeholder at
  JIT-provision time that `/welcome` now always overwrites with a real,
  user-entered name. No change to provisioning.
- **Clerk dashboard "Name" field** config is irrelevant now that the name is
  captured in-app; leaving it off is fine.
- **No separate "preferred/spoken name" field.** Spoken name is derived from the
  first word; a later profile edit can refine it.
- **No reorder of family-vs-identity.** Family-first is preserved per the design
  decision; identity capture stays inside `/welcome` after the family fork.

## Affected files

- `packages/core/src/onboarding.ts` — extend input + write (edit)
- `packages/core/src/names.ts` — shared `defaultSpokenName` (new)
- `packages/core/src/accounts.ts` — import shared helper (edit)
- `packages/core/src/index.ts` — export surface if the input type/name changes (edit)
- `apps/web/app/welcome/WelcomeFlow.tsx` — add name step (edit)
- `apps/web/app/welcome/actions.ts` — `completeAccountOnboarding` (edit)
- `apps/web/app/welcome/page.tsx` — email read + `initialName` prop (edit)
- `apps/web/app/welcome/onboarding-name.ts` — pre-fill helper (new)
- `apps/web/app/_copy/welcome.ts` — name-step copy (edit)
- test files for the above (core onboarding/names, web helper)
