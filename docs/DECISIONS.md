# DECISIONS

Every non-obvious choice and its one-line rationale. Newest at top within each section.

## Onboarding & family flows (account side)

- **Family discovery is opt-in; joining is always steward-approved; discovery exposes only family
  name + steward name.** Full rationale + rejected alternatives in `docs/adr/0001-family-discovery-and-join-requests.md`.
- **Member invitations are modeled distinctly from link session tokens.** An invitation creates an
  Account + Membership; a link session is an anonymous, account-less capture identity (the token IS
  the identity — a mechanism for capturing without an account, assuming nothing about who the person
  is). See ADR-0001.
- **Natural-language family search is a `FamilySearch` seam** with a deterministic keyword impl now;
  an LLM slots behind the same interface later, keeping vendor calls off the offline-test path.
- **Clerk identities are provisioned just-in-time, not by webhook.** A new Clerk user becomes an
  Account + Person at the `/auth/callback` landing (name pulled from Clerk), idempotently. Full
  rationale + rejected webhook in `docs/adr/0005-clerk-identities-are-provisioned-just-in-time.md`.
- **The domain magic-link is implemented under Clerk via sign-in tokens (`ticket`), not Clerk's
  email-magic-link strategy.** See the "Clerk implementation" section of ADR-0003.
- **Dev runs real Clerk; the mock is the keys-absent (CI/offline) fallback.** The presence of valid
  `sk_*`/`pk_*` keys IS the mode switch (`isClerkConfigured()`). Clerk-on means real Clerk sign-up
  into fresh accounts and `/dev/sign-in` is inert (it sets a cookie the Clerk adapter ignores); for
  seeded-family demos, run with keys absent (mock + `/dev/sign-in`).
- **Clerk-mode seed binds personas to real Clerk users by email.** Rather than create Clerk users (a
  reseed would pollute Clerk), the seed queries `clerkClient().users.getUserList({ emailAddress })`
  for personas whose emails match pre-created Clerk test users, stores the real `userId` as the
  Account's `authProviderUserId`, and skips the `mock_auth_users` credential insert. A persona with no
  matching Clerk user is skipped with a warning (never half-bound). The seed stays authoritative for
  seeded personas' `displayName`/`spokenName` — name-from-Clerk applies only to net-new sign-ups.
- **Mock auth provider for dev/test** (the `mock_auth_users` table plays Clerk's user store). Account
  still stores only `authProviderUserId`, never a password — credentials live in the mock store and
  production swaps in the Clerk adapter unchanged.
- **`Person.onboardedAt` gates the first-sign-on onboarding flow; `Person.birthDate` stores the full
  DOB** captured there (alongside the coarse `birthYear` the interviewer already reads).

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
  synthetic question-voice only — never the narrator's preserved recordings.)

## Architecture & layout

- **Monorepo via pnpm workspaces (no Turborepo yet).** pnpm workspaces alone give shared types
  and one install graph; Turborepo is a task-runner nicety left as a trivial later add.
- **Shared contracts first.** Per global preference: domain enums/types + the Drizzle schema are
  defined in `packages/db` (and re-exported) as the blocking first step before any feature code,
  so every package reads one canonical set of states/tiers/roles.
- **Package split:** `packages/db` (schema = the spec made executable, client, migrations),
  `packages/core` (the IP: authorization function, consent ledger, story state machine,
  permission tiers), `packages/pipeline` (capture→transcribe→synthesize + vendor interfaces +
  mocks), `packages/interviewer` (behavior policy), `apps/web` (Next.js capture surface + hub,
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
  evidence); (b) DB-first → if storage fails, a Media row exists pointing at nothing (the narrator
  thinks their voice was preserved; it wasn't). (a) is the lesser evil for a voice-capture
  product. A periodic GC of unreferenced storage objects (older than N hours) is a Phase-2 housekeeping
  task; pinned by a regression test that asserts the partial-failure invariant explicitly
  (`packages/capture/test/capture.test.ts`).
- **Narrator profile read goes through a `getNarratorProfile` core helper, not a direct `persons`
  query in the page.** `persons` is on the open schema (not behind the front-door guard), so the
  architecture test does not require this, but routing the read through `@chronicle/core`
  preserves the "endpoints do not roll their own access logic" pattern by convention for the
  capture surface too. If a future Phase-1 page is added it should follow suit.
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
  First pass used `listStoriesForViewer` with the narrator's own AuthContext and projected
  metadata in the consumer adapter. Defensible — the narrator is owner; the audited call did
  return only-permitted rows — but the safe-metadata contract lived in the consumer rather
  than at the boundary. Added `listNarratorMemoryForInterviewer(db, narratorPersonId, limit)` to
  `story-repository.ts` (already in the architecture allowlist). It SELECTs only
  `id/title/summary/tags/promptQuestion/createdAt`. Transcript/prose/storageKey are
  structurally unreachable through this function. The interviewer adapter is now a thin
  pass-through.
- **`follow_up` is consumed on use (review I4 round 2).** The picker emits `follow_up` when
  the narrator's last utterance is ≥12 words. Initially `lastNarratorUtterance` was not cleared on
  consumption, so the picker could re-emit `follow_up` on every subsequent turn until the
  narrator spoke again. Fix: `recordTurnCompleted` clears `lastNarratorUtterance` on the
  `follow_up` case. A new utterance via `recordResponse` still triggers a fresh follow_up;
  only same-utterance re-firing is suppressed. Regression test pins the fall-back to `base`.
- **Voice persona is configuration, persona id is forwarded per-turn (locked from spec).**
  Spec: "the same warm voice every session is a dignity requirement". `turn-loop.ts` forwards
  the same `deps.voiceId` on every `voice.speak` call; test pins this. The interviewer's
  synthetic voice is entirely distinct from the narrator's preserved original recordings — the
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
  that could write Media. State stays `pending_approval`; the narrator's NEXT voice action is
  approval. Correction is gated on `pending_approval` so a post-share edit cannot
  silently rewrite a story without a new consent event.
- **Storage-first ordering applies to approval audio too.** Same authenticity-beats-polish
  ordering as `ingestRecording`: upload approval-audio bytes to storage BEFORE the DB tx.
  If the DB tx fails, the narrator's spoken approval is still durable in object storage
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
- **Invite verifies BOTH inviter AND chosen narrator are active members of the chosen family
  (review I6 round 2).** Without the second check, a signed-in account could mint a session
  token binding an arbitrary Person to a Family the narrator is not actually in — exactly the
  cross-family identity confusion the Person/Membership split exists to prevent (spec Part
  II). The form's narrator dropdown was also tightened to show only co-members; the server
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

## Increment 7 review responses

- **The relay closes atomically inside the approval transaction.** Spec wording: "on
  approval, the Ask flips to `answered` with a pointer to the Story." Implementation folds
  the ask flip INTO the same `db.transaction` as the consent ledger insert in
  `approveAndShareStory`. An observer never sees "approved + shared story without an
  answered ask" or vice versa. Rollback proven by the same DROP-table mechanism used for
  the consent atomicity test.
- **One Ask → one Story (invariant).** The atomic flip path AND the standalone
  `markAskAnswered` helper both reject an attempt to answer the same Ask with a different
  Story (raises `InvariantViolation`). The schema doesn't enforce uniqueness on
  `asks.storyId`, but the write surface does — and the write surface is the audited
  boundary.
- **markRouted is best-effort from the turn loop.** The turn loop calls
  `askSource.markRouted(askId)` AFTER the synthesized turn is ready, in a try/catch that
  swallows failures. Rationale: a DB hiccup must NOT erase the warm phrased question the
  narrator is about to hear (spec: "never interrupts the narrator; buffered"). The next
  successful turn / a retry catches the bookkeeping up; the asker-side notification
  briefly showing `queued` instead of `routed` is an acceptable consistency lag.
- **Asker notification view (`/hub/asks`) resolves story links through the front door.**
  `listAsksByAsker` returns the asker's submitted Asks; for `answered` ones the page calls
  `getStoryForViewer` and only renders a "Listen" link if the asker is authorized to read
  the story. Otherwise it shows "Answered (not shared with you)" — the asker knows their
  question was answered without leaking the story content. The same authorization function
  the hub feed uses.
- **`createCoreAskSource` uses ONLY core exports — no direct asks-table import.** Same
  discipline as the memory adapter: the interviewer never reaches around `@chronicle/core`
  for the seam. Architecture allowlist unchanged.

## Vendor adapters (Phase 1 finish)

Each adapter was built by a sub-agent, reviewed by a cold fresh-eyes sub-agent, and re-fixed.
The notes here are the load-bearing design decisions that came out of those reviews — NOT a
recap of every fix.

- **Groq (Whisper Turbo) — zero-byte guard + non-JSON 200 handling.** The adapter rejects
  zero-byte input BEFORE any network call (matches the orchestrator's "empty transcript is
  terminal" stance — see I3 round 2) so we never burn a paid call on bytes that cannot
  possibly transcribe. It also defends against the surprisingly common "HTTP 200 with a
  text/plain error body" Groq edge case: a 2xx whose body is not JSON is treated as a
  vendor failure, not silently coerced into an empty transcript. Both shapes have
  regression tests.
- **ElevenLabs — `output_format` query-param mechanism only; empty body = error.** The
  adapter selects the audio format via the documented `?output_format=` query parameter
  and does NOT send an `Accept` header (ElevenLabs ignores `Accept` and returns mp3 by
  default — sending it gives the false impression you can negotiate). A 200 with an empty
  body is treated as a vendor failure (otherwise the interviewer would happily "speak"
  silence at the narrator). Single mechanism = single bug surface.
- **R2 (`@aws-sdk/client-s3`) — `If-None-Match: *` for atomic write-once; presigned GET
  (1h default); ONE documented exception in the vendor-SDK guard.** Write-once semantics
  are enforced AT THE PROVIDER via `If-None-Match: *` on `PutObject` so two racing capture
  requests cannot silently overwrite the canonical recording (defense in depth on top of
  the storage-key uniqueness). Reads are served via presigned GET URLs with a 1h default
  expiry so audio bytes never round-trip through our Next.js process. R2 is the ONLY
  adapter that lives in the existing `packages/storage` tree (rather than a new
  `*-r2` package) — chronologically the R2 stub already lived there. That forced one
  explicit exception in the vendor-SDK guard's ALLOWED_VENDOR_SDK_FILES list for
  `packages/storage/src/r2.ts`. The threshold for adding another exception is "the
  adapter package's existence would itself violate a stronger invariant"; otherwise new
  adapters get their own package.
- **Clerk — prefix-validated activation; static-import middleware (Edge-safe); one
  `isClerkConfigured()` shared across runtime/middleware/layout.** Activation is gated
  not by mere env-var presence but by VALIDATING the key prefixes
  (`sk_test_`/`sk_live_` for the secret, `pk_test_`/`pk_live_` for the publishable) —
  catches the "developer pasted the wrong env value" failure mode where Clerk would
  otherwise initialize and then 500 on first request. Middleware imports Clerk
  statically (Next.js middleware runs on the Edge runtime where dynamic `await import()`
  has historically been fragile across versions). The `isClerkConfigured()` predicate
  is the single source of truth used by runtime wiring, middleware, and the root
  layout — three call sites cannot disagree about whether Clerk is on.
- **Inngest — Map-based register (NOT array + find); 24h dedupe window documented;
  `signingKey` removed from client options.** Initial implementation stored functions
  in an array and did linear `find()` on dispatch. That breaks against the real
  `InngestFunction.id()`, which prefix-qualifies the id (`{appId}-{registeredName}`) —
  a naive equality match misses every function. Fix: register into a `Map` keyed by the
  function's actual reported id. The 24h dedupe window (Inngest's default for event-id
  collisions) is documented because our pipeline retry semantics interact with it (a
  manually triggered re-run within 24h of a failed run with the same job key WILL be
  deduped server-side; this is intended). `signingKey` was removed from the client
  constructor options — it is a `serve()` concern (the receiving HTTP handler verifies
  signatures), not a client concern; leaving it on the client gave false safety.
- **Supabase Postgres — `Database` type narrowed so `db.query.stories` is a COMPILE
  error; migration race fixed via INSERT-as-lock; SSL `require` by default; in-process
  bootstrap gated by `CHRONICLE_RUN_MIGRATIONS=1`.** The single most load-bearing
  decision: the Drizzle client's `Database` type parameter is narrowed to
  `Record<string, never>` (an empty schema) so any code that writes
  `db.query.stories.findMany()` fails AT COMPILE TIME, not just at runtime via
  `undefined`. A `@ts-expect-error` test in `packages/core/test/architecture.test.ts`
  pins this — if anyone ever loosens the type, the test breaks. Migration race was a
  real bug: two app instances starting simultaneously both saw "no migrations applied"
  and both tried to apply the same set, double-running idempotent-but-not-concurrent
  migrations. Fixed by inserting a sentinel row into a lock table as the very first
  step; the second instance gets a unique-key violation and backs off. SSL defaults to
  `require` (not `prefer`) so a misconfigured prod env fails loud, not silent. The
  whole bootstrap is gated by `CHRONICLE_RUN_MIGRATIONS=1` — production deploys run
  migrations as a separate step, never on every cold start.
- **Single-schema, no incremental migrations while the schema is molten (2026-06-28).**
  During heavy development we do NOT maintain a chain of incremental migration files.
  `src/schema.ts` is the single source of truth; `pnpm --filter @chronicle/db db:generate`
  (`scripts/gen-schema.mjs` → `drizzle-kit export`) regenerates `drizzle/schema.sql`, the full
  DDL, and `drizzle/invariants.sql` holds the structural guarantees drizzle can't model (the
  append-only / media-immutability triggers and the partial unique indexes). Two primitives in
  `migrate.ts`: `applySchema(pg)` creates the schema if the DB is empty (boot + tests, never
  destructive), and `resetSchema(db)` BLOWS the DB away (`DROP SCHEMA public CASCADE`) and
  re-applies it. The dev seed calls `resetSchema`, so the loop to pick up a schema change is:
  edit `schema.ts` → `db:generate` → reseed. This deletes the previous `_chronicle_meta`
  incremental runner and the `elder_sessions`→`link_sessions` rename migration: it also kills the
  stale-dev-DB footgun (an old DB whose schema predated a new migration could no longer break a
  reseed, because reseed rebuilds from scratch). Prod stays safe — `applySchemaToPostgres` applies
  only if absent and NEVER drops; a real migration tool comes back when the schema stabilizes.

## Prompt storage (deferred — recorded so it's a choice, not an accident)

- **Today: prompts are inline `SYSTEM_PROMPT` consts co-located with their call site.** Each
  LLM-facing step (`pipeline/render-story.ts`, `pipeline/extract-biography.ts`,
  `interviewer/phraser.ts`, `interviewer/intake-extraction.ts`) hardcodes its system prompt next
  to the message builder and response parser that depend on its shape. At 4 prompts, one author,
  git-versioned, the cost of this is ~zero. We are NOT building a prompt registry yet.
- **But this is explicitly a deferred decision, not the end state.** Prompts are human text under
  active development, not code: in a real AI app they are continually eval-scored and improved,
  they need per-vendor/model variants (a Claude prompt and a Llama prompt for the *same* step
  diverge on JSON discipline, system-vs-user placement, formatting idiosyncrasies), and they must
  be versioned, audited, and changeable **without a redeploy**. Inline consts structurally give
  exactly one prompt per call site and can only change by shipping code — both wrong for that
  trajectory.
- **Target design when we build it: split the prompt into contract (code) and wording (data).**
  The load-bearing constraint is that "hot-swappable prompt" is in direct tension with the
  prompt→parser coupling (`render-story`'s prompt requests JSON `prose/title/summary/tags` and
  `parseRenderResponse` is hard-wired to exactly those fields). Resolve it by versioning the two
  halves differently:
  - **Output contract** (requested schema + the parser/validator that enforces it) stays in code
    and is redeploy-gated. A wording change must never be able to silently alter the field set a
    parser reads in prod.
  - **Wording** (persona, rules, phrasing, behavior policy like "authenticity beats polish") moves
    to a versioned store, keyed `purpose → { vendor/model → version }`, recording which version is
    live. This is the part that gets eval-scored, audited, rolled back, and swapped without deploy.
- **Trigger to build it:** the first time we need EITHER a second vendor/model variant of an
  existing prompt OR a prompt change that must ship without a redeploy. Until then, leave the
  inline consts. (Discussed 2026-06-29; deferred deliberately.)

## Workflow

- **Subagent-driven build + fresh adversarial review.** Coding sub-agents write the code; the
  main agent orchestrates. When a coding sub-agent finishes a task, it (or the main agent) spawns
  a *separate, cold, fresh-eyes* adversarial code-reviewer sub-agent. The coding sub-agent then
  consumes that review output and iterates on its own code until the review comes back clean,
  with a *new* reviewer each round. This supersedes the earlier "sub-agents are review-only; lead
  engineer writes all code" rule (corrected 2026-06-27) and the general "use Agent Teams"
  preference. Net: coding agents both write and fix; reviewers are independent and per-round.
