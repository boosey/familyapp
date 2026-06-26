# DECISIONS

Every non-obvious choice and its one-line rationale. Newest at top within each section.

## Stack & vendor selections (resolving the spec's "OR" options)

- **Language: TypeScript end-to-end; no Python pipeline service.** Spec Part V explicitly
  permits this ("the Python service is a recommendation, not a requirement"); one language
  maximizes agent velocity and keeps the whole pipeline in one testable toolchain. Interface
  boundary to vendors is identical either way.
- **ORM/DB: Drizzle ORM + PGlite for dev/test, Postgres (Supabase) for prod.** Spec offers
  "Prisma OR Drizzle". Chose Drizzle because its PGlite integration runs *real Postgres
  in-process*, so the append-only ledger trigger and permission joins are exercised by tests
  with zero server to provision — the load-bearing invariants become genuinely testable. Same
  Postgres dialect ships to Supabase/Neon unchanged.
- **Queue: Inngest (named prod) behind a `JobQueue` interface.** Spec offers "Inngest OR
  Trigger.dev". Both TS-native; picked Inngest. The pipeline IP (idempotent stages, invariants)
  runs against an in-process JobQueue impl in dev/test so it is testable without the Inngest
  dev server; the Inngest binding is a thin adapter (seam).
- **Auth: Clerk (named prod) behind an `AuthProvider` interface.** Spec offers "Clerk OR
  Auth0/Supabase Auth". Account stores only the provider user id. Dev/test use a stub provider;
  the real Clerk adapter is stubbed where it needs billing/signup (see OPEN-QUESTIONS).
- **Object storage: Cloudflare R2 (named prod) behind a `MediaStorage` interface.** Spec offers
  "Supabase Storage / R2 / S3". R2's zero egress fits audio playback. Dev/test use a
  local-filesystem/in-memory impl. Media table stores keys, never blobs.
- **Transcriber default: Groq Whisper Large v3 Turbo**, behind a `Transcriber` interface, with
  Grok STT / Deepgram / AssemblyAI as configurable alternates (A/B seam). Mock used in tests.
- **LLM default: Anthropic Claude**, behind a `LanguageModel` interface. Mock/deterministic
  stub in tests. Prompts + behavior policy live in our code, never the vendor's.
- **TTS default: ElevenLabs**, behind a `Voice` interface. Mock in tests. (Interviewer's
  synthetic question-voice only — never the elder's preserved recordings.)

## Architecture & layout

- **Monorepo via pnpm workspaces (no Turborepo yet).** pnpm workspaces alone give shared types
  and one install graph; Turborepo is a task-runner nicety left as a trivial later add.
- **Shared contracts first.** Per global preference: domain enums/types + the Drizzle schema are
  defined in `packages/db` (and re-exported) as the blocking first step before any feature code,
  so every package reads one canonical set of states/tiers/roles.
- **Package split:** `packages/db` (schema = the spec made executable, client, migrations),
  `packages/core` (the IP: authorization function, consent ledger, story state machine,
  permission tiers), `packages/pipeline` (capture→transcribe→synthesize + vendor interfaces +
  mocks), `packages/interviewer` (behavior policy), `apps/web` (Next.js elder surface + hub,
  added at increment 2). Vendor SDKs may only appear in adapter files, never in core/interviewer.
- **Append-only ledger enforced at TWO layers:** (1) a Postgres trigger that raises on
  UPDATE/DELETE of `consent_records`, and (2) a repository that exposes only append + read. Both
  are tested (the trigger via PGlite). Revocation is always a new superseding row.

## Workflow

- **Not using Agent Teams for implementation; using fresh adversarial reviewer sub-agents** per
  the kickoff mandate. The mandate's build→review→enhance loop with a *cold* reviewer per round
  is the more specific instruction and overrides the general "use Agent Teams" preference here.
  I (lead engineer) write all code; sub-agents are review-only and never fix.
