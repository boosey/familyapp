# Signup Onboarding Reorder + Clerk Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Sign up" lead through an explicit family-first onboarding spine (name family → DOB → intake → hub) so a new user is always asked for a family name, and theme Clerk's `<SignIn>`/`<SignUp>` to match the Kindred design so sign-up no longer breeds distrust.

**Architecture:** All work is in `apps/web`. The onboarding reorder is driven by one function — `resolvePostAuthRoute` — whose gate order flips so the family gate precedes the DOB gate; the `/welcome` "doors" fork is deleted so DOB flows straight into intake; and `/families/new` + `/hub/about-you` route their exits through `resolvePostAuthRoute` so no path can strand a family-less user on `/hub`. Clerk theming is a plain `appearance` style object applied to both auth pages and `ClerkProvider`.

**Tech Stack:** Next.js 15 (App Router, server components + server actions), React 19, Clerk (`@clerk/nextjs`, dynamic-imported), Vitest + Testing Library, PGlite for DB-backed tests.

**Conventions:**
- Run a single web test file: `pnpm --filter @chronicle/web exec vitest run <path-relative-to-apps/web>`
- Typecheck the web package: `pnpm --filter @chronicle/web typecheck`
- Commit author must be boosey for the Vercel gate: prefix commits with `git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit ...`
- End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Reorder `resolvePostAuthRoute` (family gate before DOB gate)

This is the core of the onboarding change. Today a not-onboarded user goes to `/welcome` first (DOB), and the family step hangs off the `/welcome` doors fork. After this task, a not-onboarded user with no family/no request goes to the create-or-find fork first; DOB is asked only once a family intent exists.

**Files:**
- Modify: `apps/web/lib/post-auth-route.ts`
- Test: `apps/web/__tests__/post-auth-route.test.ts`

- [ ] **Step 1: Update the existing test + add the new-ordering cases**

In `apps/web/__tests__/post-auth-route.test.ts`, add `createFamily` to the `@chronicle/core` import:

```ts
import {
  createAccountWithPerson,
  completeOnboarding,
  createJoinRequest,
  createFamily,
} from "@chronicle/core";
```

Replace the existing `it("routes a not-onboarded person to /welcome", ...)` block (the one that creates `post-auth-fresh` with no family) with this — a not-onboarded, family-less person now goes to the fork:

```ts
  it("routes a not-onboarded, family-less person to /families/start (family-first gate)", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-fresh",
      email: "post-auth-fresh@example.test",
      displayName: "Fresh Signup",
    });
    // No family, no request, not onboarded → establish a family first.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/families/start");
  });

  it("routes a not-onboarded person who already has a family to /welcome (DOB before hub)", async () => {
    const db = await createTestDatabase();
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-newfam",
      email: "post-auth-newfam@example.test",
      displayName: "New Steward",
    });
    await createFamily(db, { name: "The Test Family", creatorPersonId: personId });
    // Active (steward) membership exists but onboardedAt is still null.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/welcome");
  });

  it("routes a not-onboarded, family-less person WITH a pending request to /welcome (find → DOB)", async () => {
    const db = await createTestDatabase();
    const { boudreauxFamilyId } = await seedInto(db, new InMemoryMediaStorage());
    const { personId } = await createAccountWithPerson(db, {
      authProviderUserId: "post-auth-findfirst",
      email: "post-auth-findfirst@example.test",
      displayName: "Finder First",
    });
    await createJoinRequest(db, {
      familyId: boudreauxFamilyId!,
      requesterPersonId: personId,
    });
    // Requested to join (pending) but not onboarded → proceed to DOB.
    await expect(resolvePostAuthRoute(db, personId)).resolves.toBe("/welcome");
  });
```

Leave the other three existing tests unchanged (onboarded+pending → `/families/find`, onboarded+no-request → `/families/start`, onboarded+family → `/hub`) — they pin Gate C, Gate A, and the settled case respectively.

- [ ] **Step 2: Run the tests to verify the new cases fail**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/post-auth-route.test.ts`
Expected: FAIL — the "family-first gate" and "already has a family → /welcome" and "pending → /welcome" cases fail because the current code returns `/welcome` for the family-less fresh user and doesn't check family before DOB.

- [ ] **Step 3: Rewrite `resolvePostAuthRoute` with the new gate order**

Replace the whole body of `apps/web/lib/post-auth-route.ts` with:

```ts
/**
 * Central post-authentication router. After any sign-in / sign-up / onboarding-completion the web
 * layer asks this one helper where to send the Person, so the family gate + onboarding gate live in
 * exactly one place. Order is family-FIRST:
 *
 *   Gate A. no family AND no pending join request → /families/start (the create-or-find fork)
 *   Gate B. a family intent exists but not onboarded (onboarded_at IS NULL) → /welcome (DOB)
 *   Gate C. onboarded but still awaiting approval on a join request → /families/find
 *   else  → /hub
 *
 * Identity-graph reads only (persons + the audited membership/join-request core funcs) — no content.
 */
import "server-only";
import { eq } from "drizzle-orm";
import { persons } from "@chronicle/db/schema";
import {
  listActiveMembershipsForPerson,
  listJoinRequestsByRequester,
} from "@chronicle/core";
import type { Database } from "@chronicle/db";

export async function resolvePostAuthRoute(
  db: Database,
  personId: string,
): Promise<string> {
  const [p] = await db
    .select({ onboardedAt: persons.onboardedAt })
    .from(persons)
    .where(eq(persons.id, personId))
    .limit(1);

  const active = await listActiveMembershipsForPerson(db, personId);
  const requests = await listJoinRequestsByRequester(db, personId);
  const hasPending = requests.some((r) => r.status === "pending");

  // Gate A — a family intent must exist first (create or find). This is the family-first reorder:
  // a brand-new account with no family and no request goes to the fork, NOT straight to DOB.
  if (active.length === 0 && !hasPending) return "/families/start";

  // Gate B — DOB is the one required onboarding step, asked once a family intent exists.
  if (!p || p.onboardedAt == null) return "/welcome";

  // Gate C — onboarded but still awaiting approval on a join request: the finder's "Your requests"
  // section is where that request's status lives.
  if (active.length === 0 && hasPending) return "/families/find";

  return "/hub";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/post-auth-route.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/post-auth-route.ts apps/web/__tests__/post-auth-route.test.ts
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
fix(web): family-first post-auth routing (fork before DOB)

resolvePostAuthRoute now sends a family-less, request-less new account to
the /families/start create-or-find fork before asking for DOB, and asks
DOB once a family intent (membership or pending join request) exists.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Route `/families/new` submit through `resolvePostAuthRoute`

After creating a family, a not-onboarded creator must continue to `/welcome` (DOB), not jump to `/hub`. The destination is exactly the "not-onboarded person who already has a family → /welcome" case pinned in Task 1, so this task is a one-line redirect swap verified by typecheck.

**Files:**
- Modify: `apps/web/app/families/new/page.tsx`

- [ ] **Step 1: Import `resolvePostAuthRoute` and swap the redirect**

In `apps/web/app/families/new/page.tsx`, add the import beside the others:

```ts
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
```

In the `create()` server action, replace the final `redirect("/hub");` with:

```ts
  redirect(await resolvePostAuthRoute(db, ctx.personId));
```

(`db` and `ctx` are already in scope in that action.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/families/new/page.tsx
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
fix(web): after creating a family, continue to onboarding (DOB) not /hub

Route the /families/new create action through resolvePostAuthRoute so a
not-onboarded creator lands on /welcome for DOB, keeping the family-first
spine intact.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Delete the `/welcome` "doors" fork; DOB flows straight into intake

The doors fork is what let a user skip family creation. Remove it: after DOB, go directly to `/hub/about-you` (intake).

**Files:**
- Modify: `apps/web/app/welcome/WelcomeFlow.tsx`
- Modify: `apps/web/app/welcome/page.tsx`
- Test: `apps/web/__tests__/welcome-flow.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `apps/web/__tests__/welcome-flow.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * WelcomeFlow: after the DOB step is saved, the flow routes STRAIGHT into the intake surface
 * (/hub/about-you) — the old "doors" fork is gone, so family creation can no longer be skipped
 * from here. Mocks the saveDob server action and next/navigation's router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WelcomeFlow } from "@/app/welcome/WelcomeFlow";

vi.mock("@/app/welcome/actions", () => ({
  saveDob: vi.fn(async () => {}),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { saveDob } from "@/app/welcome/actions";

describe("WelcomeFlow", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("after saving DOB, routes into intake (no doors fork)", async () => {
    render(<WelcomeFlow firstName="Alex" invited={false} />);

    // welcome step → begin ("Let's begin")
    fireEvent.click(screen.getByRole("button", { name: /begin/i }));

    // dob step: the three selects are month / day / year in order.
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "6" } });
    fireEvent.change(selects[1], { target: { value: "15" } });
    fireEvent.change(selects[2], { target: { value: "1970" } });

    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await waitFor(() =>
      expect(saveDob).toHaveBeenCalledWith({ year: 1970, month: 6, day: 15 }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hub/about-you"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/welcome-flow.test.tsx`
Expected: FAIL — currently `submitDob` calls `setStep("doors")`, so `push` is never called with `/hub/about-you`. (It may also fail to compile until the `hubDestination` prop is removed in Step 3 — that's fine, still red.)

- [ ] **Step 3: Remove the doors step from `WelcomeFlow.tsx`**

In `apps/web/app/welcome/WelcomeFlow.tsx`:

(a) Change the `Step` type (drop `doors`):

```ts
type Step = "welcome" | "dob";
```

(b) Change the component signature to drop `hubDestination`:

```ts
export function WelcomeFlow({
  firstName,
  invited,
}: {
  firstName: string;
  invited: boolean;
}) {
```

(c) In `submitDob`, replace `setStep("doors");` with a navigation into intake:

```ts
  async function submitDob() {
    if (!dobComplete) return;
    setBusy(true);
    setError(null);
    try {
      await saveDob({ year: Number(year), month: Number(month), day: Number(day) });
      router.push("/hub/about-you");
    } catch {
      setError(welcome.dobSaveError);
      setBusy(false);
    }
  }
```

(Note: on success we intentionally leave `busy` true — the page is navigating away and unmounting; only reset it on the error path so the button re-enables.)

(d) Delete the entire `if (step === "doors") { ... }` block (the whole fork render, roughly lines 244–329). The `welcome` and `dob` render blocks stay. `router` is still used (now in `submitDob`), so keep the `useRouter` import.

- [ ] **Step 4: Stop passing `hubDestination` from `welcome/page.tsx`**

In `apps/web/app/welcome/page.tsx`:

- Remove the import `import { listActiveMembershipsForPerson } from "@chronicle/core";`
- Delete these two lines:

```ts
  const active = await listActiveMembershipsForPerson(db, ctx.personId);
  const hubDestination = active.length > 0 ? "/hub" : "/families/start";
```

- Change the render to drop the prop:

```tsx
  return (
    <WelcomeFlow
      firstName={firstName}
      invited={from === "invite"}
    />
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/welcome-flow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck (catches any dangling doors-only copy references)**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS. (Unused `welcome.destination*` / `welcome.*Card*` / `welcome.introduce*` copy keys are harmless object properties; leave them.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/welcome/WelcomeFlow.tsx apps/web/app/welcome/page.tsx apps/web/__tests__/welcome-flow.test.tsx
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
fix(web): welcome DOB flows straight into intake (remove doors fork)

The /welcome "doors" step let users skip family creation. Delete it so
DOB completion routes directly to /hub/about-you; family creation now
happens earlier via the /families/start fork.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Route `/hub/about-you` exits through `resolvePostAuthRoute`

Make intake completion/skip (and the two "nothing to ask" early exits) resolve through the router so a family-less user can never be left on `/hub` — closing the original bug structurally.

**Files:**
- Modify: `apps/web/app/hub/about-you/page.tsx`

- [ ] **Step 1: Resolve the destination once and use it everywhere**

In `apps/web/app/hub/about-you/page.tsx`, add the import:

```ts
import { resolvePostAuthRoute } from "@/lib/post-auth-route";
```

After the auth check, compute the destination and use it for both early redirects and the `hubHref` prop:

```ts
  const { db, auth } = await getRuntime();
  const ctx = await auth.getCurrentAuthContext();
  if (ctx.kind !== "account") redirect("/sign-in");

  const dest = await resolvePostAuthRoute(db, ctx.personId);

  const anchors = await createCoreAnchorSource(db).loadForNarrator(ctx.personId);
  // No person row / unreadable profile → nothing to ask. Bounce to wherever they belong.
  if (!anchors) redirect(dest);

  const answered = new Set<string>(await listAnsweredQuestionKeys(db, ctx.personId));
  const askedSet = new Set<keyof BiographicalProfile>();
  for (const q of INTAKE_QUESTIONS) if (answered.has(q.key)) askedSet.add(q.key);
  const first = nextIntakeQuestion(anchors.profile, askedSet);
  // Profile already complete (or all questions answered) → nothing to ask.
  if (!first) redirect(dest);

  return (
    <AboutYouFlow
      initialQuestion={{ key: first.key, text: first.text }}
      hubHref={dest}
    />
  );
```

(`AboutYouFlow`'s prop stays named `hubHref`; only the value changes. The existing `about-you-flow.test.tsx` passes a literal `hubHref="/hub"` to the client component and is unaffected.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.

- [ ] **Step 3: Verify the existing intake test still passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/about-you-flow.test.tsx`
Expected: PASS (unchanged — the client component still just navigates to whatever `hubHref` it's given).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/hub/about-you/page.tsx
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
fix(web): intake exits route through resolvePostAuthRoute

/hub/about-you now resolves its exit (complete, skip, and the two
nothing-to-ask early redirects) via resolvePostAuthRoute, so intake can
never strand a family-less user on /hub.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Home page → just "Sign in" and "Sign up"

Move the create-vs-find bifurcation off the home page (it now lives in `/families/start`, reached after sign-up).

**Files:**
- Modify: `apps/web/app/_copy/auth.ts`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Add a generic sign-up label to the landing copy**

In `apps/web/app/_copy/auth.ts`, in the `landing` object, replace the `createFamily` line with a `signUp` label:

```ts
  landing: {
    eyebrow: "Est. 2026",
    tagline:
      "A warm place to gather your family's stories — and to help the people you love tell theirs before they're lost.",
    signUp: "Sign up",
    signIn: "Sign in",
    narratorNote:
      "Invited a narrator to record? They open their own personal link — they never sign in here.",
  },
```

(The warm "create your family" wording still lives on the sign-up screen header — `auth.signUp.title` = "Create your family" — and on the `/families/start` fork's "start a new family" door, so nothing warm is lost.)

- [ ] **Step 2: Use the new label on the home page**

In `apps/web/app/page.tsx`, change the primary CTA label:

```tsx
        <Link href="/sign-up" style={{ textDecoration: "none" }}>
          <KindredButton label={auth.landing.signUp} size="large" />
        </Link>
```

(The `/sign-in` secondary button is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS (fails loudly if any other file still references `auth.landing.createFamily`; none should — `hub.ts` has its own separate `createFamily`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/_copy/auth.ts apps/web/app/page.tsx
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
feat(web): home page offers Sign up / Sign in only

The create-or-find choice moves into the post-signup /families/start fork,
so the landing page's primary CTA is a plain "Sign up".

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Theme Clerk with the Kindred `appearance`

Make real-Clerk `<SignIn>`/`<SignUp>` look like the app: a shared `appearance` object, the widgets wrapped in the branded `AuthScreen` shell, and the theme applied provider-wide.

**Files:**
- Create: `apps/web/lib/clerk-appearance.ts`
- Test: `apps/web/__tests__/clerk-appearance.test.ts` (new)
- Modify: `apps/web/app/sign-up/[[...sign-up]]/page.tsx`
- Modify: `apps/web/app/sign-in/[[...sign-in]]/page.tsx`
- Modify: `apps/web/app/layout.tsx`

- [ ] **Step 0: Confirm the Clerk `appearance` API + the accent-text token**

Before writing the object, fetch the current Clerk `appearance` docs via Context7 (resolve `/clerkinc/clerk-docs` or the Clerk SDK, query "customize appearance variables and elements SignIn SignUp"). Confirm the `variables`/`elements` key names used below still match. Also open `apps/web/app/_kindred/tokens.css` (or `KindredButton`) to confirm the CSS var used for text ON the accent button; use it in place of the `var(--on-accent, #fffdf7)` fallback below if a real token exists.

- [ ] **Step 1: Write the failing structural test**

Create `apps/web/__tests__/clerk-appearance.test.ts`:

```ts
/**
 * kindredClerkAppearance is a PLAIN, serializable theme object: no functions, no @clerk import
 * (so it stays safe to import from the mock build), and it flattens Clerk's own card so the
 * widget nests inside the AuthScreen shell.
 */
import { describe, expect, it } from "vitest";
import { kindredClerkAppearance } from "../lib/clerk-appearance";

describe("kindredClerkAppearance", () => {
  it("is a plain serializable theme object (no functions / no component refs)", () => {
    expect(() => JSON.parse(JSON.stringify(kindredClerkAppearance))).not.toThrow();
    expect(kindredClerkAppearance.variables.colorPrimary).toBe("var(--accent)");
  });

  it("flattens Clerk's own card so it nests inside the AuthScreen shell", () => {
    expect(kindredClerkAppearance.elements.card).toMatchObject({
      boxShadow: "none",
      border: "none",
      background: "transparent",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-appearance.test.ts`
Expected: FAIL — `../lib/clerk-appearance` does not exist yet.

- [ ] **Step 3: Create the appearance module**

Create `apps/web/lib/clerk-appearance.ts`:

```ts
/**
 * Kindred theming for Clerk's hosted <SignIn>/<SignUp>/<UserButton>. A plain, serializable style
 * object — it MUST NOT import from @clerk/* so it can be imported from any module (including the
 * mock build) without pulling Clerk into the graph. Values reference the live Kindred CSS custom
 * properties (from _kindred/tokens.css) so the theme tracks the design system, not a copy of it.
 *
 * Property names follow Clerk's `appearance` API (variables + elements). Verified against current
 * Clerk docs (see plan Task 6, Step 0) — do not edit from memory.
 */
export const kindredClerkAppearance = {
  variables: {
    colorPrimary: "var(--accent)",
    colorText: "var(--text-body)",
    colorTextSecondary: "var(--text-muted)",
    colorBackground: "var(--surface-card)",
    colorInputBackground: "var(--surface-page)",
    colorInputText: "var(--text-body)",
    colorDanger: "var(--accent-strong)",
    fontFamily: "var(--font-ui)",
    borderRadius: "var(--radius-md)",
  },
  elements: {
    rootBox: { width: "100%" },
    // Flatten Clerk's own card so it sits inside the AuthScreen shell, not as a competing widget.
    card: {
      boxShadow: "none",
      border: "none",
      background: "transparent",
      padding: 0,
    },
    // AuthScreen already renders the title/subtitle — hide Clerk's duplicate header.
    headerTitle: { display: "none" },
    headerSubtitle: { display: "none" },
    formButtonPrimary: {
      backgroundColor: "var(--accent)",
      color: "var(--on-accent, #fffdf7)",
      fontFamily: "var(--font-ui)",
      borderRadius: "var(--radius-md)",
      textTransform: "none",
    },
    formFieldLabel: { fontFamily: "var(--font-ui)", color: "var(--text-meta)" },
    formFieldInput: {
      background: "var(--surface-page)",
      borderColor: "var(--border)",
      borderRadius: "var(--radius-md)",
      color: "var(--text-body)",
    },
    footerActionLink: { color: "var(--accent-strong)", fontWeight: 600 },
  },
} as const;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @chronicle/web exec vitest run __tests__/clerk-appearance.test.ts`
Expected: PASS.

- [ ] **Step 5: Wrap `<SignUp>` in the AuthScreen shell + apply appearance**

In `apps/web/app/sign-up/[[...sign-up]]/page.tsx`, add the import:

```ts
import { kindredClerkAppearance } from "@/lib/clerk-appearance";
```

Replace the Clerk branch (the `if (isClerkConfigured()) { ... }` block) with:

```tsx
  if (isClerkConfigured()) {
    // Dynamic import keeps @clerk/nextjs out of the mock build's module graph.
    const { SignUp } = await import("@clerk/nextjs");
    return (
      <AuthScreen title={auth.signUp.title} subtitle={auth.signUp.subtitle}>
        <SignUp
          appearance={kindredClerkAppearance}
          forceRedirectUrl="/auth/callback"
          signInForceRedirectUrl="/auth/callback"
          signInUrl="/sign-in"
        />
      </AuthScreen>
    );
  }
```

(`AuthScreen` and `auth` are already imported in this file. Clerk keeps its own themed "Already have an account? Sign in" link, so no `footer` is needed.)

- [ ] **Step 6: Wrap `<SignIn>` in the AuthScreen shell + apply appearance**

In `apps/web/app/sign-in/[[...sign-in]]/page.tsx`, add the import:

```ts
import { kindredClerkAppearance } from "@/lib/clerk-appearance";
```

Replace the Clerk branch with:

```tsx
  if (isClerkConfigured()) {
    const { SignIn } = await import("@clerk/nextjs");
    return (
      <AuthScreen title={auth.signIn.title} subtitle={auth.signIn.subtitle}>
        <SignIn
          appearance={kindredClerkAppearance}
          forceRedirectUrl="/auth/callback"
          signUpForceRedirectUrl="/auth/callback"
          signUpUrl="/sign-up"
        />
      </AuthScreen>
    );
  }
```

(Clerk's themed "No account? Sign up" link — driven by `signUpUrl="/sign-up"` — is the funnel that sends a mistaken sign-in into sign-up → the fork. The mock branch already has its own "New here? Create an account" footer via `auth.signIn.newHere` / `createAccount`, so both modes funnel.)

- [ ] **Step 7: Apply the appearance provider-wide**

In `apps/web/app/layout.tsx`, add a static import at the top (safe — the module has no `@clerk/*` import):

```ts
import { kindredClerkAppearance } from "../lib/clerk-appearance";
```

Change `wrapWithClerk` to pass it to the provider:

```tsx
async function wrapWithClerk(body: React.ReactElement): Promise<React.ReactElement> {
  // Dynamic import keeps @clerk/nextjs out of the dev bundle entirely when Clerk is not wired.
  const { ClerkProvider } = await import("@clerk/nextjs");
  return <ClerkProvider appearance={kindredClerkAppearance}>{body}</ClerkProvider>;
}
```

- [ ] **Step 8: Typecheck + full web test run**

Run: `pnpm --filter @chronicle/web typecheck`
Expected: PASS.

Run: `pnpm --filter @chronicle/web test`
Expected: PASS (all web tests green, including the new `post-auth-route`, `welcome-flow`, and `clerk-appearance` cases).

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/clerk-appearance.ts apps/web/__tests__/clerk-appearance.test.ts apps/web/app/sign-up/[[...sign-up]]/page.tsx apps/web/app/sign-in/[[...sign-in]]/page.tsx apps/web/app/layout.tsx
git -c user.name="boosey" -c user.email="boosey.boudreaux@gmail.com" commit -m "$(cat <<'EOF'
feat(web): theme Clerk sign-in/sign-up to match Kindred

Add a shared kindredClerkAppearance object (plain, no @clerk import),
wrap <SignIn>/<SignUp> in the branded AuthScreen shell, and apply the
appearance to ClerkProvider so the whole Clerk surface matches the app.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Manual browser verification (Clerk appearance is visual)

Automated tests can't judge the themed look. Verify the full spine in a browser with real Clerk keys (or note this is deferred to the deployed preview if local Clerk keys aren't available).

- [ ] **Step 1: Start the dev server**

Run: `pnpm --filter @chronicle/web dev`

- [ ] **Step 2: Walk the create spine**

Home → **Sign up** → complete Clerk sign-up (confirm the widget matches Kindred: warm background, Kindred font, accent button, no floating stock card) → lands on **/families/start** → **Start a new family** → name the family → **/welcome** greeting → DOB → **/hub/about-you** intake → **/hub**. Confirm the family name you entered shows in the hub header (not the fallback "chronicle" label).

- [ ] **Step 3: Walk the find spine (as far as pending)**

Home → Sign up (new account) → /families/start → **Find a family** → search + request to join → confirm you continue to /welcome (DOB) → intake → hub with the pending state.

- [ ] **Step 4: Confirm the sign-in funnel**

Home → **Sign in** → confirm the themed "No account? Sign up" link is present and routes to /sign-up.

---

## Self-Review

**Spec coverage:**
- Home = Sign in / Sign up → Task 5. ✅
- Bifurcation moves into `/families/start` (no Clerk intent param) → achieved by Task 1's Gate A routing a fresh account to `/families/start`; no new params added. ✅
- Family-first order (name family → DOB → intake → hub) → Task 1 (gate order) + Task 2 (create → DOB) + Task 3 (DOB → intake) + Task 4 (intake exit). ✅
- Delete `/welcome` doors fork → Task 3. ✅
- `/welcome` self-guard keys on `onboardedAt` only → already true in code; left unchanged (noted in Task 3 Step 4). ✅
- Intake can't strand a no-family user on `/hub` → Task 4. ✅
- Clerk `appearance` from Kindred tokens, applied to `<SignUp>`/`<SignIn>`/`<ClerkProvider>`, wrapped in `AuthScreen` → Task 6. ✅
- Sign-in-no-account funnel present in both modes → Task 6 Steps 6 (Clerk `signUpUrl`) + mock footer already exists. ✅
- Regression tests for the routing matrix → Task 1; WelcomeFlow doors removal → Task 3; appearance structure → Task 6. ✅
- Find path stays thin (reuse `/families/find`, no new mechanics) → no task adds join mechanics. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows real assertions and a run command with expected result. ✅

**Type/name consistency:** `resolvePostAuthRoute(db, personId)` signature is used identically in Tasks 1, 2, 4. `kindredClerkAppearance` named identically in the module, test, and all three consumers. `hubHref` prop name preserved in Task 4. `WelcomeFlow` prop shape (`firstName`, `invited`) matches between Task 3's component edit and its test. ✅

**Known soft spots (flagged, not blocking):**
- Task 6 Clerk `appearance` key names + the `--on-accent` token are verified at implementation time (Task 6 Step 0), not assumed — the one library-API dependency in the plan.
- Task 2's redirect wiring has no isolated test (server action + `redirect()` throw is brittle to unit-test); its behavior is pinned by Task 1's "not-onboarded with family → /welcome" case + typecheck.
