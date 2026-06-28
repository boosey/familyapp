# Initial user flows — overnight build handoff

Built while you slept, on branch **`feat/onboarding-and-family-flows`** (not merged to master).
Everything green: `pnpm -r typecheck`, `pnpm -r test`, and `next build` all pass. Each slice was
written by a builder teammate and passed through a **fresh, independent adversarial reviewer**; every
finding was fixed before commit (details at the bottom).

## What you asked for ↔ what's there

| Your ask | Status | Where |
|---|---|---|
| 1. Sign up & **create a new family** | ✅ | `/sign-up` → onboarding → `/families/start` → **Start a new family** (`/families/new`) → you're the steward |
| 2. Sign up & **request to join** (by steward name, member, or NL description) | ✅ | `/families/find` — deterministic keyword/NL-ish search over discoverable families; **Request to join** → steward approves in the hub **Requests** tab |
| 3. Sign up by **clicking an invite link** | ✅ | `/join/[token]` — welcome screen (inviter/family/relationship) → create login → onboarding → hub |
| 4. **Invite someone unknown** to the system | ✅ | Hub **Invite** tab → "Invite a family member" → generates a one-time `/join/<token>` link |
| 5. **First sign-on** onboarding flow | ✅ | `/welcome` state machine: welcome → DOB (required) → two doors → lightweight typed interview |
| 6. **Subsequent sign-on** → dashboard | ✅ | `/sign-in` → `resolvePostAuthRoute` → `/hub` |

## Key decision (read this)

Your "find & request to join a family" ask punches a hole in the spec's privacy-first model, so I made
it **opt-in + approval-gated** and wrote it down: **`docs/adr/0001-family-discovery-and-join-requests.md`**.
- Families are **private by default**; a steward must flip `discoverable` on to be findable.
- Search returns **only family name + steward name** — never members or stories. (Member names are a
  *matching signal* so "the Naples bakers, Rosa's family" finds them, but they're never shown.)
- Finding a family never joins it — it creates a **join request the steward approves/declines**.
- Natural-language search is a **seam** (`FamilySearch` interface) with a deterministic keyword impl now;
  a real LLM drops in behind the same interface later, no rewrite.

Glossary updated in `CONTEXT.md`; rationale in `docs/DECISIONS.md`.

## Try it (≈5 min)

```
pnpm --filter @chronicle/web dev
```
Then open **`/dev/seed`** and click **Reseed**. The seed page now prints everything you need:
the **member-invite link** (`/join/<token>`), **Sofia's sign-in** (`sofia@example.test` / `password`),
and a pointer to `/families/find`. Seeded data: Eleanor (elder), Sofia (steward) + Marco (members),
the **Boudreaux** family (discoverable, described), **Theo** (a non-member with a pending join request
for Sofia to approve), and a pending **invitation** for "Maya".

**Each capability, end to end:**
1. **Create a family** — `/sign-up` (any new email) → DOB → "Go to the hub" lands you on `/families/start`
   → **Start a new family** → name it → you're the steward, in the hub.
2. **Find & request to join** — as a new signed-up user, `/families/find` → search `Lafayette` or
   `Eleanor` or `teachers` → Boudreaux appears → **Request to join**. Then sign in as Sofia → hub
   **Requests** tab → Approve. (Theo is pre-seeded so the tab isn't empty on first look.)
3. **Invite-link signup** — from the seed page, open the **member invite link** → "Sofia invited you to
   the Boudreaux family" → set a password → you're in, then onboarding → hub as a member.
4. **Invite someone unknown** — sign in as Sofia → hub **Invite** tab → "Invite a family member" →
   name/email/relationship → copy the one-time `/join/<token>` link.
5. **First-time onboarding** — any fresh `/sign-up` drops into `/welcome`: confirm → **DOB (required)** →
   two doors → optional 3-question typed interview (birthplace / places lived / key moments).
6. **Returning user** — sign in as `sofia@example.test` / `password` → straight to `/hub` (she's onboarded).

## Honest limitations / stubs

- **Auth is mocked, by design.** A `mock_auth_users` table plays Clerk's user store; real signup/signin
  works (scrypt-hashed passwords) but it is **not** Clerk. The `Account` row still stores only an opaque
  provider id and never a password, so the real Clerk adapter (already present) swaps in unchanged.
- **Voice is stubbed.** This environment has no mic/browser, so the onboarding "say it out loud" buttons
  are visible stubs with a real typed fallback (the typed path is the working one). I could not click
  through the live browser UI here — verification is via typecheck + `next build` + unit/integration
  tests, not manual browser QA. **Please click through it once yourself.**
- **NL search is keyword-based**, not an LLM (deliberately — keeps tests offline). The seam is ready.
- **DOB stores a full `birth_date`** plus the coarse `birth_year` the interviewer already used.
- The onboarding interview saves facts into `persons.biographical_anchors`; it is **not** wired to the
  heavy audio/transcribe pipeline (that was the agreed "lightweight" scope).

## ⚠️ Commit hygiene note

The branch started on a working tree that **already had uncommitted prior work** (your hi-fi design pass
+ era feature). My onboarding work is entangled with some of those files, so the web commit (`246d42f`)
**bundles that pre-existing `apps/web` work** — it couldn't be split at file granularity. Unrelated
`docs/design-system/**` churn and `CLAUDE.md` edits were left **unstaged** (still in your working tree,
untouched). If you want the onboarding work isolated from the prior hi-fi work, that separation has to be
done by hand — flag me and I'll help.

## Commits on the branch

```
246d42f feat(web): onboarding + family flows (landing, auth, invite, join, steward approvals)
04a7744 feat(core,web): account/family/invite/join-request domain + mock auth
2d128de feat(db): freeze contract for onboarding + family flows
+ chore(web): surface member-invite link + steward creds on dev seed page
```

## How it was built (your process asks)

Shared-contract-first (frozen schema + API doc before any parallel work), then an **agent team**:
`core-builder` + `auth-builder` in parallel, each followed by a **separate cold adversarial reviewer**
(`core-reviewer`, `auth-reviewer`), then `web-builder` + `web-reviewer`, with `core-builder` doing the
dev-seed in parallel. Reviewers caught and I fixed: a non-atomic signup that could permanently lock out
an email, two join/invite race windows (closed with a DB partial-unique index + transactions), and three
web auth-robustness issues (anonymous server-action 500s, a `/welcome` self-overwrite, strict-index nits).
Every bug fix got a companion regression test. **53 new core tests + 30 web/db tests, all green.**

## Suggested next steps

- Click through the 6 flows in a real browser and tell me what feels off (copy, routing, the relationship-
  edit affordance on the invite screen).
- Decide whether `/families/find` should also let people request families they can *name exactly* even when
  not `discoverable` (currently strictly opt-in — the conservative choice).
- When ready for real auth: wire Clerk (the adapter exists; set the env keys) — the mock falls away with
  no app changes.
