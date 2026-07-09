# AGENTS.md

Standard commands, architecture, and conventions live in `CLAUDE.md` and `docs/`. Read those first.

## Cursor Cloud specific instructions

- Runtime: Node >=20 (VM has v22) and pnpm 10.33.0 (from `packageManager`). `pnpm install` is the only dependency step; the update script already runs it on startup.
- The whole product runs with **zero external services or API keys** in dev. When keys are absent (the default here), `apps/web/lib/runtime.ts` self-provisions in-process fallbacks: PGlite (persisted at `apps/web/.pglite/dev`), a filesystem media store (`apps/web/.media`), a synchronous in-process pipeline, mock email+password auth, and scripted AI mocks. Do not try to provision Postgres/R2/Inngest/Clerk/Groq to run locally.
- Only one long-running service exists: the Next.js web app. Start it from the repo root with `pnpm dev` (→ `@chronicle/web` → `next dev`). Everything else in `packages/*` is a source-only library imported via `workspace:*` (no build/watch step in dev).
- The dev server is pinned to **port 3000**. A `predev` hook hard-fails if 3000 is already bound (it will NOT auto-shift to 3001). Reuse the existing server or free the port; override with `PORT` only if needed.
- Because there is no AI key in dev, the scripted `LanguageModel` mock echoes prompt-shaped placeholder text. The story "polish"/render step therefore shows raw-looking text instead of a real rewrite — this is expected mock behavior, not a bug.
- Fastest way to a populated, authenticated hub for manual testing: visit `/dev/seed` and click "Reseed", then `/dev/sign-in` to "become" a seeded user (e.g. Sofia Boudreaux). The brand-new-signup onboarding path (name/birthday "about-you" steps) does not always advance cleanly; the dev seed + dev sign-in path is the reliable entry point.
- `pnpm lint` (oxlint), `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass on a clean tree. If lint/typecheck fail, check your own diff first — the baseline is green.
