# Signup onboarding reorder + Clerk theming — Design

Date: 2026-07-02
Status: Approved (pending spec review)
Scope: `@chronicle/web` only. No schema changes, no core changes.

## Problem

Two defects in the new-account experience:

1. **A new user can reach the hub without ever being asked for a family name — so it's unclear whether a family was even created.** The current onboarding fork ("doors" step in `/welcome`) offers "Introduce yourself" as a sibling to "Go to the hub". Choosing it routes to `/hub/about-you` (intake), which finishes on a hardcoded `/hub` — silently skipping family creation. `/hub` has no no-family guard, so the user lands there family-less.

2. **The stock Clerk `<SignUp>`/`<SignIn>` widgets look nothing like the app**, breeding distrust at the exact moment a new user is deciding whether to commit. No `appearance`/theming is configured anywhere today; the custom Kindred design system styles only the mock-mode forms, not real Clerk.

## Approved decisions

- **Onboarding order:** name family → DOB → intake → hub (family-first).
- **Home page:** only **Sign in** and **Sign up**. The create-vs-find bifurcation moves *into* the post-signup flow (the existing `/families/start` chooser), so no "intent" needs to travel through Clerk.
- **Clerk:** theme the existing Clerk components via the `appearance` API (not a fully-headless rebuild). Clerk keeps handling verification / OAuth / bot protection.
- **Find path stays thin:** reuse the existing `/families/find` screen and join mechanics. No new join features this pass.
- **Keep the `/welcome` greeting beat** before DOB.

---

## Change 1 — Onboarding flow

### Target sequence

```
Home  ──▶ Sign up ──▶ [account created]
                          │
                          ▼
                   /families/start   (the create-or-find fork)
                    ├── Create ──▶ /families/new (name family) ──┐
                    └── Find   ──▶ /families/find (request join) ─┤
                                                                  ▼
                                                          /welcome  (greeting → DOB)
                                                                  │
                                                                  ▼
                                                     /hub/about-you (intake, skippable)
                                                                  │
                                                                  ▼
                                                                /hub
```

A mistaken **Sign in** with no account funnels to Sign up via Clerk's existing "No account? Sign up" link (`signUpUrl="/sign-up"`), landing the person in the same fork.

### The single routing brain: `apps/web/lib/post-auth-route.ts`

Rewrite `resolvePostAuthRoute` so the **family gate is evaluated before the onboarding (DOB) gate** — this is the whole reorder. New logic, in order:

```
active   = listActiveMembershipsForPerson(personId)
requests = listJoinRequestsByRequester(personId)
hasPending = requests.some(r => r.status === "pending")

// Gate A — establish a family intent first (create or find)
if (active.length === 0 && !hasPending) return "/families/start"

// Gate B — DOB is required once a family intent exists
if (onboardedAt == null) return "/welcome"

// Gate C — settled
if (active.length === 0 && hasPending) return "/families/find"  // onboarded, still awaiting approval
return "/hub"
```

State matrix this produces:

| active family | pending req | onboardedAt | → route |
|---|---|---|---|
| no | no | — | `/families/start` |
| yes | — | null | `/welcome` |
| no | yes | null | `/welcome` |
| yes | — | set | `/hub` |
| no | yes | set | `/families/find` |
| no | no | set | `/families/start` |

Note the last row: an onboarded user who somehow has no family/no request is sent back to establish one — the family gate can no longer be bypassed by any path.

### Touch points

1. **`apps/web/app/page.tsx`** — relabel the primary CTA from "Create your family" to a generic **"Sign up"** (still → `/sign-up`); keep **"Sign in"**. Keep the warm eyebrow/tagline. Copy change in `app/_copy` (`auth.landing`): the primary label becomes a sign-up label; the "create your family" warmth already lives on `/families/start` (`families.start.fresh*`).

2. **`apps/web/app/families/new/page.tsx`** — the `create()` server action currently ends `redirect("/hub")`. Change to `redirect(await resolvePostAuthRoute(db, ctx.personId))` so a freshly-created-family user flows to `/welcome` (DOB) instead of jumping to the hub.

3. **`apps/web/app/welcome/WelcomeFlow.tsx`** — **delete the `doors` step entirely**. The state machine becomes `welcome → dob`. On successful `saveDob()`, instead of `setStep("doors")`, navigate straight to intake: `router.push("/hub/about-you")`. Remove the now-unused `hubDestination` prop and the `doors`-only copy usages.

4. **`apps/web/app/welcome/page.tsx`** — remove the `hubDestination` computation (lines ~47-48) and stop passing it to `<WelcomeFlow>`. The existing `onboardedAt != null → resolvePostAuthRoute` self-guard stays as-is (it already keys on `onboardedAt` only, so a just-created-family user is NOT bounced).

5. **`apps/web/app/hub/about-you/page.tsx`** — replace the hardcoded `hubHref="/hub"` passed to `<AboutYouFlow>` with `await resolvePostAuthRoute(db, ctx.personId)`. Also route the two "nothing to ask" early redirects (currently `redirect("/hub")`) through `resolvePostAuthRoute`. This guarantees intake completion/skip can never strand a no-family user on `/hub` — it sends them to `/families/start` or `/families/find` as appropriate. (`AboutYouFlow`'s prop stays named `hubHref`; only the value changes.)

`/families/start` and `/families/find` need **no logic changes** — they already exist and self-guard. `/families/start` remains the fork; its `/families/new` and `/families/find` doors are unchanged.

### What is deliberately NOT changed
- No new "intent" query params through Clerk — the fork is a screen, not a signal.
- No new join mechanics; `/families/find` is reused verbatim.
- No schema, no `@chronicle/core` changes.

---

## Change 2 — Theme Clerk (`appearance` API)

Goal: make real-Clerk `<SignIn>`/`<SignUp>` visually indistinguishable from the Kindred mock forms (`app/_auth/AuthScreen` + `_kindred`), so the sign-up moment feels like part of the app.

### Approach

1. **New shared module `apps/web/lib/clerk-appearance.ts`** exporting a `kindredClerkAppearance` object built from the live Kindred CSS custom properties (so it tracks the design system, not a copy of it):
   - `variables`: `colorPrimary`, `colorText`, `colorBackground`, `colorInputBackground`, `fontFamily`, `borderRadius`, etc. → `var(--accent)`, `var(--text-body)`, `var(--surface-card)`, `var(--font-ui)`, `var(--radius-md)` …
   - `elements`: style the primary button (`formButtonPrimary`), inputs (`formFieldInput`), labels, links, and — importantly — flatten Clerk's own card (`card: { boxShadow: "none", border: "none", background: "transparent" }`) so it sits cleanly *inside* the `AuthScreen` shell rather than as a competing floating widget.
   - Exact property names verified against current Clerk docs (Context7 / Clerk SDK snippets) at build time — Clerk's `appearance` surface is versioned and must not be written from memory.

2. **Wrap the Clerk components in the branded shell.** In `apps/web/app/sign-up/[[...sign-up]]/page.tsx` and `apps/web/app/sign-in/[[...sign-in]]/page.tsx`, render `<SignUp>/<SignIn>` inside `<AuthScreen title subtitle footer>` (the same shell the mock forms already use), passing `appearance={kindredClerkAppearance}`. The footer keeps the cross-link (sign-up ↔ sign-in) so the "no account → sign up" funnel is prominent in both real and mock modes.

3. **Apply appearance app-wide** in `apps/web/app/layout.tsx` `wrapWithClerk()` — pass `appearance={kindredClerkAppearance}` to `<ClerkProvider>` so the `UserButton` (account menu sign-out) and the magic-link redeem screen inherit the theme too.

4. **Mock parity:** confirm the mock-mode sign-in `AuthScreen` footer surfaces a clear "New here? Create an account" link mirroring the themed Clerk one (sign-up already has its cross-link).

### Constraints
- Keep the dynamic-import isolation (`await import("@clerk/nextjs")`) so `@clerk/nextjs` never enters the mock build's module graph. `clerk-appearance.ts` must be a plain style object with **no** `@clerk/*` imports, so it is safe to import from anywhere.
- If a base theme from `@clerk/themes` is used, it is additive under our `variables`/`elements`; the Kindred tokens win.

---

## Verification

### Automated (regression tests — required per project rule)
Extend **`apps/web/__tests__/post-auth-route.test.ts`** to cover the full new state matrix above, especially the reordered gates:
- no family + no pending → `/families/start`
- has family + not onboarded → `/welcome`
- pending + not onboarded → `/welcome` (the find→DOB path)
- onboarded + pending (no family) → `/families/find`
- onboarded + family → `/hub`
- onboarded + no family + no pending → `/families/start` (bypass-proof gate)

Add/extend a test asserting **`/families/new`'s `create()` action routes via `resolvePostAuthRoute`** (lands on `/welcome` for a not-onboarded creator), and that **`about-you` completion/skip** resolves through `resolvePostAuthRoute` rather than a literal `/hub`.

`WelcomeFlow` no longer has a `doors` step — update/trim `apps/web/__tests__/about-you-flow.test.tsx` and any welcome tests that assert on the doors fork.

### Manual / browser (Clerk appearance is visual)
Run the app with real Clerk keys and confirm `<SignUp>`/`<SignIn>` match the Kindred shell (colors, font, radius, flattened card), then walk the full spine: Sign up → `/families/start` → Create → name family → DOB → intake → hub, verifying the family name is asked and the created family's name shows in the hub. Repeat the Find branch as far as the pending state.

## Risks / trade-offs
- **Clerk `appearance` ceiling:** theming can only reach what Clerk exposes; if a specific element resists styling, we accept a close-but-not-pixel-perfect match rather than escalating to a headless rebuild (explicitly out of scope).
- **Find path thinness:** a pending-join user briefly lands on `/hub` (or `/families/find`) with no active family and the fallback chronicle label. Accepted for this pass.
- **Reorder blast radius:** `resolvePostAuthRoute` is called by sign-in, sign-up, welcome, and auth-callback. The new gate order changes where *every* not-onboarded no-family user goes first (now `/families/start` instead of `/welcome`). The test matrix is the guard against regressions here.
