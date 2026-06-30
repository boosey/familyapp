# E2E tests (`@chronicle/web`)

Browser-level tests of the Next.js app with [Playwright Test](https://playwright.dev). These
complement — they do not replace — the Vitest unit/integration suites (`pnpm -r test`).

## Run

```bash
# from repo root
pnpm --filter @chronicle/web test:e2e         # headless
pnpm --filter @chronicle/web test:e2e:ui      # interactive UI mode
pnpm --filter @chronicle/web test:e2e:report  # open the last HTML report
```

First run only, install the browser binary:

```bash
pnpm --filter @chronicle/web exec playwright install chromium
```

## How it works (hermetic by design)

`playwright.config.ts` boots a **throwaway** dev server — it never touches your everyday setup:

| Concern | Test server | Your `pnpm dev` |
| --- | --- | --- |
| Port | **3100** | 3000 |
| Auth | Clerk keys blanked → **mock provider** (`/dev/sign-in` works) | real Clerk from `.env.local` |
| Database | `DATABASE_URL` blanked + `CHRONICLE_DB_DIR=.pglite/e2e` (disposable) | `.pglite/dev` |
| Media | `CHRONICLE_MEDIA_DIR=.media-e2e` (disposable) | `.media` |
| AI pipeline | GROQ/XAI/ANTHROPIC keys blanked → **ScriptedTranscriber/LanguageModel** (offline, deterministic) | real vendors if keys present |

`DATABASE_URL` is blanked **deliberately and is load-bearing**: `lib/runtime.ts` uses managed
Postgres whenever `DATABASE_URL` is set and then ignores `CHRONICLE_DB_DIR`. Since `reseed()` runs
`resetSchema` (a full drop-and-recreate), an un-blanked `DATABASE_URL` would let the suite wipe a
real database. Keep it blanked.

Each spec calls `reseed()` (`POST /api/dev/seed`) for a known, independent dataset — `beforeAll`
for read-only specs, `beforeEach` for `record-approve.spec.ts` (which mutates story state). The
suite runs **serially** (`workers: 1`) because the single in-process PGlite DB is shared global
state — parallel specs would stomp each other's seed.

### Server reuse is opt-in

By default the suite **always spawns a fresh hermetic server** (and CI never reuses). Set
`PW_REUSE_SERVER=1` only when you know the server already on `:3100` is this hermetic one (e.g. fast
local reruns) — otherwise Playwright would silently reuse whatever is there and never apply the
isolation env above, passing tests for the wrong reason.

## Coverage

- `narrator-capture.spec.ts` — the `/s/[token]` capture surface (valid token + warm fallback).
- `hub-auth.spec.ts` — `/dev/sign-in` → authenticated `/hub`.
- `record-approve.spec.ts` — **hybrid**: UI render assertions for the voice-gated approval surface,
  plus API-level integration of the real record→render→`pending_approval`→shared transitions through
  the `/api/capture` and `/api/capture/approve` multipart seams (deterministic on the offline pipeline).

## Adding a test

- **Token surfaces** (`/s/[token]`, `/a/[token]`): no auth — open the URL from the seed result.
- **Authenticated surfaces** (`/hub`, …): drive `/dev/sign-in` → "Become <name>", which sets the
  mock session the same way the real app does. Prefer this over poking cookies directly.
- Assert on stable user-facing copy from `app/_copy/*` rather than CSS/DOM structure.

## Follow-ups (TODO)

These were deliberately left open when the suite was first set up:

1. **Wire into CI.** Add a job that runs
   `pnpm --filter @chronicle/web exec playwright install --with-deps chromium` then
   `pnpm --filter @chronicle/web test:e2e` with `CI=1` (enables retries + the `github` reporter).
   The suite is hermetic, so it needs no secrets.
2. **Production-fidelity server.** Run the suite against `next build && next start` (production
   build) instead of `next dev`, so e2e catches build-only issues (RSC bundling, prod middleware,
   env inlining). Today `webServer.command` is `next dev` for local ergonomics.
