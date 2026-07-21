# Architecture

*How the codebase implements the product. Build commands: `CLAUDE.md`.*

## Monorepo layout

```
familyapp/
├── apps/web/          Next.js 15 — Tell Me Again UI + API routes
├── packages/
│   ├── db/            Drizzle schema, migrations, PGlite test helper
│   ├── core/          Authorization, repositories, state machine (the IP)
│   ├── storage/       MediaStorage interface + adapters
│   ├── capture/       Link sessions, ingest, approval
│   ├── pipeline/      Transcribe, prose passes, job queue
│   ├── interviewer/   Controlled turn loop, behavior policy
│   └── [vendor adapters]  groq, anthropic, elevenlabs, r2, queue-inngest, etc.
└── docs/              Strategy, ADRs, this folder
```

Packages publish TypeScript source directly (`"main": "./src/index.ts"`). No inter-package build step in dev.

## The single front door (load-bearing)

**All reads of Story/Media content go through `@chronicle/core` authorization.**

Structural enforcement:

1. `@chronicle/db` main entry does **not** export raw `stories`/`media` tables
2. Drizzle client built **without** `schema` registration — `db.query.stories` is undefined
3. `packages/core/test/architecture.test.ts` fails CI on bypass imports outside allowlist

**Allowlist (content reads/writes):** `authorization.ts`, `story-repository.ts` (+ deliberate additions only)

New content paths require allowlist update — keeps audited surface tiny.

## Package responsibilities

### `@chronicle/db`

- `schema.ts` — single source of truth
- **Snapshot** (`drizzle/schema.sql`) — fast path for PGlite tests
- **Migration chain** (`drizzle/migrations/`) — incremental for Neon prod
- Drift-guard test bonds snapshot ↔ migrations

### `@chronicle/core`

| Module | Role |
|--------|------|
| `authorization.ts` | `decideStoryRead`, `decideMediaRead` |
| `story-repository.ts` | Audited story writes, hub list projections |
| `consent.ts` | Ledger append + read |
| `story-state.ts` | `assertStoryTransition` |
| `asks.ts`, `invitations.ts`, `memberships.ts` | Family lifecycle |
| `album-repository.ts`, `story-image-repository.ts` | Imagery |
| `kinship-repository.ts` | Tree projection + governance |
| `follow-up-record.ts` | Audited follow-up decisions |

### `@chronicle/capture`

| Module | Role |
|--------|------|
| `sessions.ts` | Hashed link-session tokens |
| `capture.ts` | `ingestRecording` — storage-first, then DB |
| `approval.ts` | Voice approval path (link session) |
| `identity.ts` | `CaptureActor` = account \| link_session |

### `@chronicle/pipeline`

| Module | Role |
|--------|------|
| `orchestrator.ts` | Legacy link-session: transcribe → render |
| `cleanup-take.ts`, `polish-prose.ts` | Prose passes |
| `multi-take.ts` | Per-take transcription |
| `extract-biography.ts` | Post-approval anchor extraction |
| `photo-ranker.ts` | Album suggestion engine |
| `job-queue.ts` | In-process; Inngest in prod |

**Two capture paths:**
- **Hub composing surface** — inline per-take transcribe+cleanup in server actions
- **Link session** — durable queue orchestrator on `/api/capture`

### `@chronicle/interviewer`

Controlled turn loop — **not open chat**.

| Module | Role |
|--------|------|
| `behavior.ts` | Priority: distress → off-ramp → ask → follow-up → base |
| `phraser.ts` | Intent → spoken question via LLM |
| `turn-loop.ts` | Session composition |
| `follow-up-evaluator.ts` | LLM candidate evaluation (ADR-0013) |
| `gap-detection.ts` | Gap-driven follow-ups |

### `@chronicle/storage`

`MediaStorage` interface — in-memory, filesystem (dev), R2 (prod). Media bytes only; no DB.

## Web app architecture

### Runtime (`apps/web/lib/runtime.ts`)

Self-provisions in dev when keys absent:
- PGlite persisted DB
- Filesystem media store
- Mock auth, email, AI
- In-process pipeline

Prod: Neon, R2, Clerk, Groq, Anthropic, Inngest.

### Auth flow

```
Request → middleware (Clerk or mock)
       → auth.getCurrentAuthContext()
       → Person + Memberships
```

**Excluded from Clerk middleware:** `/s/*`, `/a/*` page routes (token surfaces).

### Copy centralization

All user-facing strings: `apps/web/app/_copy/` (`as const`, i18n-ready).

### Design system (Kindred)

- Tokens: `apps/web/app/_kindred/tokens.css`
- Themes: `heirloom` (default), `archive`, `hearth`
- Fonts: Newsreader (stories), Public Sans (UI), mono (metadata)
- Mobile: bottom tab bar, collapsing header (ADR-0025)

## Vendor seam rule

External SDKs **only in adapter packages**. `packages/core`, `pipeline`, `interviewer`, `capture`, `db` — no vendor imports. Architecture tests enforce.

| Seam | Default vendor | Mock |
|------|----------------|------|
| Auth | Clerk | DevCookie |
| Transcribe | Groq Whisper | ScriptedTranscriber |
| LLM | Anthropic Claude | ScriptedLanguageModel |
| Voice (TTS) | ElevenLabs | ScriptedVoice |
| Storage | R2 | Filesystem |
| Queue | Inngest | InProcessJobQueue |
| Email/SMS | Resend/Twilio | Scripted |

## API routes (selected)

| Route | Purpose |
|-------|---------|
| `POST /api/capture` | Ingest recording (hub + link session) |
| `GET /api/capture/status` | Poll pipeline state |
| `POST /api/capture/approve` | Link-session approval |
| `GET /api/media/[id]` | Authorized media bytes |
| `GET /api/album-photo/[photoId]` | Album photo bytes |
| `POST /api/inngest` | Background jobs |
| `POST /api/webhooks/clerk` | Identity sync |

## Testing strategy

- **Vitest** across packages
- **PGlite** — real Postgres in-process; no external DB for CI
- **Architecture tests** — front door, vendor SDK, migration drift
- **E2E** — Playwright (limited); dev seed + sign-in for manual QA

## Deployment

- **Hosting:** Vercel (`tellmeagain.app`)
- **DB:** Neon Postgres; migrations in Vercel build (`db:migrate`)
- **Migrations never on request path**

## ADR index (decisions by number)

| ADR | Topic |
|-----|-------|
| 0001 | Family discovery opt-in |
| 0002 | Consent-scoped media immutability |
| 0003 | Magic link = account login |
| 0004 | Tap approval (hub) |
| 0005 | Clerk JIT provisioning |
| 0006 | Provisional Person for pending invitees |
| 0007 | Story origin typing |
| 0008 | Deletion and audio artifact rules |
| 0009 | Album / imagery topology |
| 0010 | Story family targeting |
| 0011 | Explore read seam |
| 0012 | Follow-up thread = one story |
| 0013 | Auditable LLM follow-up evaluation |
| 0014 | Composing surface + four passes |
| 0015 | Per-photo album import |
| 0016 | Kinship per-family tree |
| 0017 | Sibling placeholder couple |
| 0018 | Tree caret anchoring |
| 0019 | Cross-family soft-link |
| 0020 | UI constants vs preferences |
| 0021 | Family filter vs designator |
| 0022 | Feature prioritization method |
| 0023 | Invite acceptance places kin |
| 0024 | Responsive mobile (graceful now) |
| 0025 | Mobile native navigation IA |

Full text: `docs/adr/`
