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

## Increment 1 — review responses

- **Single front door made structural, not conventional (review finding I1).** `@chronicle/db`'s
  main entry no longer exports the raw content tables; `stories`/`media` are reachable only via
  the `@chronicle/db/schema` subpath, and an architecture test
  (`packages/core/test/architecture.test.ts`) fails CI if any `src/` file outside an audited
  allowlist imports that subpath. This is the spec's "no bypass path" enforced as a build gate —
  the closest a TS monorepo gets to RLS without the weight, and matching the spec's own framing
  (Part V: "impossible to bypass if reads are funneled through one module").
- **Front door round 2 (review found two real bypasses).** A second cold reviewer found the
  first guard was incomplete: (a) `client.ts` re-exported `schema` via a `@chronicle/db/client`
  subpath, and (b) registering `{ schema }` on the Drizzle client exposed the relational API
  `db.query.stories.findMany()` — a content read needing no table import at all. Fixes: the
  client no longer registers the schema (so `db.query.stories/media` are `undefined`, asserted by
  a runtime test), the `schema` re-export and the `./client` package export are removed, and the
  architecture guard now matches the schema subpath, the client subpath, and `.query.<table>`
  access. Residual, documented out-of-scope: hand-written raw SQL via `db.execute(sql`…`)` —
  an overt bypass that code review covers; no string guard distinguishes it reliably. (Full RLS
  is the only way to make even raw SQL safe; the spec's design is application-layer, Part V.)
- **Deferred (review finding I4): the story state-machine guard (`assertStoryTransition`) is not
  yet wired into a write path** because Increment 1 (the spine) creates no story mutations. It is
  built and unit-tested now and will be enforced at the capture (draft creation) and approval
  (pending→approved→shared) increments. Noted so it is not mistaken for dead code.

## Increment 2 — review responses

- **Capture-path ordering is storage-FIRST, deliberately (review I2/finding).** `ingestRecording`
  uploads the canonical audio bytes to object storage BEFORE inserting the immutable Media row
  and draft Story. A reviewer flagged the post-storage-success / pre-DB-commit window as an
  "orphan blob" risk. The ordering is correct per the LOCKED principle "authenticity beats polish
  / the original audio is canonical and never overwritten" and the spec's "audio is persisted
  immediately, before any processing" requirement. The two outcomes on partial failure are:
  (a) storage-first → if DB fails, audio is preserved in storage with no DB pointer (recoverable
  evidence); (b) DB-first → if storage fails, a Media row exists pointing at nothing (the elder
  thinks their voice was preserved; it wasn't). (a) is the lesser evil for an elder voice-capture
  product. A periodic GC of unreferenced storage objects (older than N hours) is a Phase-2 housekeeping
  task; pinned by a regression test that asserts the partial-failure invariant explicitly
  (`packages/capture/test/capture.test.ts`).
- **Elder profile read goes through a `getElderProfile` core helper, not a direct `persons`
  query in the page.** `persons` is on the open schema (not behind the front-door guard), so the
  architecture test does not require this, but routing the read through `@chronicle/core`
  preserves the "endpoints do not roll their own access logic" pattern by convention for the
  elder surface too. If a future Phase-1 page is added it should follow suit.
- **Architecture allowlist canary is EXACT membership, not a `<=8` ceiling (review I2 advisory).**
  An exact-membership check makes every addition a deliberate, reviewer-visible diff instead of
  slipping under a generous upper bound. The allowlist remains the two-file audited surface
  (`authorization.ts` + `story-repository.ts`).

## Increment 3 — review responses

- **The default `WorkingCopyTransformer` reports `speedFactor: 1.0` until real DSP lands
  (review I3 round 1).** First-round reviewer flagged a sleeper bug: the stub returned
  passthrough bytes but reported `speedFactor: 1.6`, so the orchestrator would have persisted
  word timings scaled by 1.6 against audio that wasn't sped up — every persisted word offset
  in production would have been wrong by ~60% until a real DSP adapter landed. Fix: the stub
  tells the truth about what it actually did. A real adapter that actually time-stretches will
  set the factor to 1.6; the orchestrator additionally clamps `speedFactor` to `1.0..2.0` at
  the mapping step (defense in depth against a buggy adapter — review I3 round 3). The
  hard-audio backoff and per-request stitching (Groq 10s floor) are encoded as interface seams
  only and noted as deferred work in OPEN-QUESTIONS.
- **`getStoryAndRecordingForPipeline` is reachable only via the `@chronicle/core/pipeline`
  subpath, with its own architecture guard (review I3 round 2).** The helper is a
  content-surfacing read with no `AuthContext` — system-actor use only. Re-exporting it from
  `@chronicle/core` root made the "no bypass" property convention-only for this one function.
  Fixed structurally: subpath export + new `PIPELINE_HELPER_ALLOWLIST` (currently exactly
  `packages/pipeline/src/orchestrator.ts`) in `architecture.test.ts`. Pattern mirrors the
  `@chronicle/db/content` subpath/allowlist that already protects the raw content tables.
- **The state-machine guard (`assertStoryTransition`) is wired now (Increment 1 deferral
  closed).** Every story state change in the pipeline goes through `transitionStoryState`,
  which loads the current state and routes through `assertStoryTransition`. Illegal jumps
  (e.g. archived → pending_approval) throw, and a regression test in `pipeline.test.ts`
  exercises this by pre-archiving a story and asserting the render stage refuses to advance it.
- **Empty-transcript is a terminal vendor failure, not a soft retry (review I3 round 2).**
  The transcribe stage previously persisted `""` and enqueued render; render would re-enqueue
  transcribe; the in-proc cap eventually broke the loop after 8 wasted paid vendor calls. Fix:
  the stage throws when the vendor returns empty text — the queue surfaces the error to the
  caller, the story stays at `transcript=null` so a deliberate human retry is possible, and
  exactly one vendor call is made per attempt.

## Increment 4 review responses

- **Cross-session memory: NEW audited core read, projected in SQL (review I4 round 2).**
  First pass used `listStoriesForViewer` with the elder's own AuthContext and projected
  metadata in the consumer adapter. Defensible — the elder is owner; the audited call did
  return only-permitted rows — but the safe-metadata contract lived in the consumer rather
  than at the boundary. Added `listElderMemoryForInterviewer(db, elderPersonId, limit)` to
  `story-repository.ts` (already in the architecture allowlist). It SELECTs only
  `id/title/summary/tags/promptQuestion/createdAt`. Transcript/prose/storageKey are
  structurally unreachable through this function. The interviewer adapter is now a thin
  pass-through.
- **`follow_up` is consumed on use (review I4 round 2).** The picker emits `follow_up` when
  the elder's last utterance is ≥12 words. Initially `lastElderUtterance` was not cleared on
  consumption, so the picker could re-emit `follow_up` on every subsequent turn until the
  elder spoke again. Fix: `recordTurnCompleted` clears `lastElderUtterance` on the
  `follow_up` case. A new utterance via `recordResponse` still triggers a fresh follow_up;
  only same-utterance re-firing is suppressed. Regression test pins the fall-back to `base`.
- **Voice persona is configuration, persona id is forwarded per-turn (locked from spec).**
  Spec: "the same warm voice every session is a dignity requirement". `turn-loop.ts` forwards
  the same `deps.voiceId` on every `voice.speak` call; test pins this. The interviewer's
  synthetic voice is entirely distinct from the elder's preserved original recordings — the
  Voice seam is for question TTS only and has no path that re-synthesizes a Story's audio.
- **The LLM never sees policy state.** Sensitivity gating, rapport counter, distress flag,
  Ask priorities, off-ramp detection are all in `behavior.ts`. The LLM gets a chosen Intent
  (already in code) and the absolute system rules — it cannot decide topic selection,
  consume Asks, or advance the turn counter.

## Increment 5 review responses

- **`approveAndShareStory` persists the intermediate `approved` row (review I5 round 1).**
  First pass folded `pending_approval → approved → shared` into a single UPDATE that wrote
  `state='shared'` directly while calling `assertStoryTransition` for both legs as pure
  validation. Reviewer flagged: the spec is explicit about THREE states and an observer
  inside the tx (or any after-the-fact audit query) never sees the legal intermediate.
  Fix: two sequential UPDATEs inside the same `db.transaction` — one writes
  `state='approved'` + `audienceTier` + `approvedAt`, the second writes `state='shared'`.
  `assertStoryTransition` guards each leg. Atomic and observable.
- **Capture-side approval does NOT join the audited allowlist.** `captureApproval` in
  `@chronicle/capture` deliberately routes through `getStoryForViewer` (front door) +
  `approveAndShareStory` (audited core write) instead of importing `@chronicle/db/content`.
  Keeps the architecture-test allowlist exactly `authorization.ts` + `story-repository.ts`
  — the canary stays a one-line diff if anyone ever widens it.
- **Voice correction is a coordinator, not a new write surface.** `applyVoiceCorrection`
  in `@chronicle/pipeline` composes `applyTranscriptCorrection` (audited clear) +
  `renderStoryFromTranscript` (re-render) + `updateDerivedFields` (audited persist). The
  recording pointer is structurally unreachable through this seam — there is no path here
  that could write Media. State stays `pending_approval`; the elder's NEXT voice action is
  approval. Correction is gated on `pending_approval` so a post-share edit cannot
  silently rewrite a story without a new consent event.
- **Storage-first ordering applies to approval audio too.** Same authenticity-beats-polish
  ordering as `ingestRecording`: upload approval-audio bytes to storage BEFORE the DB tx.
  If the DB tx fails, the elder's spoken approval is still durable in object storage
  (recoverable evidence > vanished recording). Tests pin both halves — DB rollback
  preserves storage; storage failure prevents any DB writes.

## Increment 6 review responses

- **Raw session token is handed via a short-lived httpOnly flash cookie, NEVER via URL query
  (review I6 round 2).** First pass redirected to the result page with
  `?token=<raw>`. Reviewer flagged: the token would land in server access logs, browser
  history, and the `Referer` header on any outbound click. Fix: the invite server action
  writes the raw token into an httpOnly cookie scoped to `/hub/invite/result` with
  `maxAge=60`; the result page reads it once and deletes it (single-view flash). DB stores
  only the sha-256 hash, unchanged.
- **Invite verifies BOTH inviter AND chosen elder are active members of the chosen family
  (review I6 round 2).** Without the second check, a signed-in account could mint a session
  token binding an arbitrary Person to a Family the elder is not actually in — exactly the
  cross-family identity confusion the Person/Membership split exists to prevent (spec Part
  II). The form's elder dropdown was also tightened to show only co-members; the server
  action is the authoritative trust boundary.
- **Membership status is filtered to `active` in every authorization-driving query (review
  I6 round 1).** Hub feed loader, invite (both the family dropdown AND the inviter check at
  submit), Ask candidate dropdown, and `createAsk` all filter `status='active'`. Spec Part
  II is explicit: "The Membership's status and role are inputs to every permission check."
- **AuthProvider is the seam; DevCookie stub for local, Clerk for prod.** The hub never
  reads `cookies()` directly except in the cookie-writer adapters (`/dev/sign-in`,
  `/hub/invite/result` flash read). Everywhere else identity flows through
  `auth.getCurrentAuthContext()` returning a core `AuthContext`. Clerk slots into this
  interface without touching pages.
- **Asks live on the OPEN schema surface (not behind the content guard).** Asks are prompts
  created by a family member, not expressive content owned by a Person. `createAsk` is in
  `@chronicle/core` for boundary consistency (single co-membership check) but does not
  need an architecture-test allowlist entry — it imports only `@chronicle/db/schema`.
- **Media playback returns 404 indistinguishable from "no access".** `/api/media/[id]` calls
  `getMediaForViewer` first; on null, returns an empty 404. Storage-miss after the auth
  check also returns 404 — no body distinguishes the two cases (an attacker timing
  difference is acceptable for Phase 1).

## Workflow

- **Not using Agent Teams for implementation; using fresh adversarial reviewer sub-agents** per
  the kickoff mandate. The mandate's build→review→enhance loop with a *cold* reviewer per round
  is the more specific instruction and overrides the general "use Agent Teams" preference here.
  I (lead engineer) write all code; sub-agents are review-only and never fix.
