# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Family Chronicle — Phase 0 (the spine) + Phase 1 (the elder voice-capture wedge). TypeScript end-to-end, pnpm workspaces monorepo, Node >=20.

Authoritative docs (read these before non-trivial work):
- `docs/Phase-0-1-Engineering-Spec.md` — the spec the code implements.
- `docs/PLAN.md` — increment-by-increment build sequence + status.
- `docs/DECISIONS.md` — why each non-obvious choice was made (stack, architecture, review responses).
- `docs/PROGRESS.md`, `docs/OPEN-QUESTIONS.md`.

## Commands

Run from repo root:
- `pnpm -r build` / `pnpm -r typecheck` / `pnpm -r test` / `pnpm -r lint`
- Single package: `pnpm --filter @chronicle/core test` (or `typecheck`, etc.)
- Single test file: `pnpm --filter @chronicle/core exec vitest run path/to/file.test.ts`
- Single test name: `pnpm --filter @chronicle/core exec vitest run -t "name pattern"`
- Web dev server: `pnpm --filter @chronicle/web dev` (Next.js 15, React 19)
- DB schema codegen: `pnpm --filter @chronicle/db db:generate` (drizzle-kit)

Tests use Vitest. The DB layer uses **PGlite** (real Postgres in-process) — there is no external Postgres to provision for `pnpm test`.

## Architecture

### Packages (`packages/*`, `apps/*`)
- `@chronicle/db` — Drizzle schema (the spec made executable), client, migrations, PGlite test helper.
- `@chronicle/core` — the IP: single authorization function, append-only consent ledger, story state machine, story write repository.
- `@chronicle/storage` — `MediaStorage` interface + in-memory/filesystem/R2 adapters. Media bytes only; no DB.
- `@chronicle/capture` — session tokens (token IS identity for the elder surface), `ingestRecording` orchestrator (storage upload → core write path).
- `@chronicle/pipeline` — `Transcriber`/`LanguageModel`/`JobQueue`/`WorkingCopyTransformer` seams + mocks, in-process queue, speech-to-story prompt + orchestrator (`transcribe → render_story`).
- `@chronicle/interviewer` — controlled turn loop wrapping `LanguageModel` (NOT an open chat). `Voice`/`AskSource`/`MemorySource`/`AnchorSource` seams + mocks; base question bank as data; behavior policy (sensitivity gating, off-ramp, distress, reminiscence bump) in `behavior.ts`; in-house system prompt + phraser in `phraser.ts`. Cross-session memory goes through the audited `listElderMemoryForInterviewer` on `story-repository.ts` (SQL projects safe metadata only).
- `@chronicle/web` — Next.js elder surface (`/s/[token]`).

Packages publish source directly (`"main": "./src/index.ts"`) and depend on each other via `workspace:*`. There is no build step between packages in dev.

### The single front door (load-bearing — do not weaken)
The spec's central Phase-0 rule: **all reads of Story/Media content go through `@chronicle/core`'s authorization function; there is no bypass path.** This is enforced structurally:

1. `@chronicle/db`'s main entry does **not** export the raw `stories`/`media` table objects. They live behind the `@chronicle/db/content` subpath.
2. The Drizzle client is constructed **without** registering `schema`, so `db.query.stories` / `db.query.media` are `undefined` (no relational API bypass).
3. `packages/core/test/architecture.test.ts` is a CI-failing test that scans the source tree and flags:
   - imports of `@chronicle/db/content`
   - imports of `@chronicle/db/client`
   - `.query.stories` / `.query.media` access
   ...anywhere outside a small ALLOWLIST (currently `authorization.ts` and `story-repository.ts`).

When you legitimately need a new content read/write path, add the file to the allowlist in that test deliberately — that keeps the audited surface tiny. Raw SQL via `db.execute(sql\`...\`)` is a documented, out-of-scope bypass (code review catches it; no string guard can reliably distinguish it).

Authorization tiers: `private` (owner only), `branch` (treated as `family` in Phase 0, value preserved), `family` (any Person sharing an ACTIVE membership with the owner), `public`. A non-owner never sees a story until it is `approved`/`shared` AND the latest sharing event in the consent ledger is `approved_for_sharing`.

### Append-only consent ledger
Enforced at **two layers**: (1) a Postgres trigger raising on UPDATE/DELETE of `consent_records`, and (2) a repository that exposes only append + read. Both are tested via PGlite. Revocation is always a new superseding row — never an edit.

### Vendor seams
Every external vendor sits behind an interface in our code with a mock for tests. Vendor SDKs may only appear in adapter files, never in `core`, `pipeline`, `interviewer`, `storage`, `capture`, or `db`. The architecture test in `packages/pipeline/test/pipeline.test.ts` scans all those src trees and fails CI on any SDK import. Defaults named in `docs/DECISIONS.md`: Groq Whisper Turbo (`Transcriber`), Anthropic Claude (`LanguageModel`), ElevenLabs (`Voice`), Cloudflare R2 (`MediaStorage`), Inngest (`JobQueue`), Clerk (`AuthProvider`), Supabase Postgres in prod.

## Conventions

- TS strict + `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM-only (`"type": "module"`).
- Domain enums/types and the Drizzle schema are the shared contract — defined in `@chronicle/db` and re-exported. Add new domain types there first.
- Story state machine: changes to `Story.state` must go through `assertStoryTransition` (in `@chronicle/core`). It is not yet wired into a write path — wire it in at the capture/approval increments when those write paths land.
- The build/review workflow for this repo is **not** Agent Teams. Per `docs/DECISIONS.md` it is build → adversarial fresh sub-agent review → enhance → re-eval with a *new* fresh reviewer until clean. Sub-agents are review-only; the lead engineer (you) writes all code.
