# DECISIONS

Every non-obvious choice and its one-line rationale. Newest at top within each section.

## Story imagery — Google Photos import (Phase 5)

- **Connect-once OAuth + Picker each import (locked 2026-07-09).** Import is the user's **own**
  Google Photos library via the **Picker API** (not Image Search; not silent Library browse — Google
  removed broad Library read scopes for most apps). Product choice: store an **encrypted refresh
  token per Person** so Google consent is once (until disconnect / revoke); each album import still
  opens a **new Picker session** (user always chooses which photos). Album UI needs Connect /
  Import / Disconnect. Rejected: strict ephemeral / no refresh token (PLAN's earlier wording) —
  that would re-prompt Google consent often and feels broken for a family album. Scope stays
  `photospicker.mediaitems.readonly`; bytes land as `family_photos` with `source='google_picker'`.

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
- **Clerk `user.updated` / `user.deleted` DO sync back via a webhook — creation stays JIT (issue #10).**
  JIT covers creation, but a rename or account deletion in Clerk otherwise leaves a stale row. The
  `POST /api/webhooks/clerk` route verifies the svix signature (`verifyWebhook` against
  `CLERK_WEBHOOK_SIGNING_SECRET` — the one vendor touch, isolated in the web adapter) and hands a
  narrow, snake-case event slice to the pure PGlite-tested `applyClerkWebhookEvent` dispatcher.
  `user.updated` → `reconcileAccountProfile` (updates the Account mirror + the controlled Person's
  `displayName`/email; the provider is source-of-truth for a self-account's name — but `spokenName`
  is user-owned and never clobbered, and a blank incoming field is a leave-untouched no-op).
  **`user.deleted` policy = SOFT-delete**: flip `accounts.active = false` and PRESERVE the Person and
  all its expressive content. A login deletion must never erase family stories other members depend on;
  owner-initiated content erasure is the SEPARATE, explicit ADR-0008 path. The severance is enforced on
  the READ side: `auth-clerk.ts`'s login resolution (`resolvePersonRow`, and the magic-link
  `resolveAuthProviderUserId`) filters `accounts.active = true`, so a deactivated account whose Clerk
  session outlives the deletion event resolves to `anonymous` — the flag is a real login gate, not inert. All handlers are declaratively
  idempotent (set-to-value / deactivate), so a Clerk retry or replayed event is a harmless no-op — no
  event-id ledger needed. Unhandled event types return 2xx (Clerk stops retrying).
- **The domain magic-link is implemented under Clerk via sign-in tokens (`ticket`), not Clerk's
  email-magic-link strategy.** See the "Clerk implementation" section of ADR-0003.
- **`establishAccountSession` returns a discriminated result, not `void` — the seam stays on
  `AuthProvider` (ADR-0003), it does not branch the route on `isClerkConfigured()`.** Mock/dev set a
  session cookie and return `{ kind: "established" }` (the route redirects straight to the
  destination); the Clerk adapter mints a sign-in token and returns `{ kind: "handoff"; ticket }`
  (the route hands off to the client redemption route `/auth/redeem`, since Clerk forbids forging a
  session server-side from a userId). The `/a/[token]` route stays provider-agnostic — it switches on
  the result kind via the pure `resolveMagicLinkTarget`, not on which provider is wired. Rejected:
  branching the route on `isClerkConfigured()` (leaks the auth vendor into the route and duplicates
  the mode switch already owned by `runtime.ts`). The reverse lookup (Person → Clerk userId) and the
  mint both sit behind injectable seams (`resolveAuthProviderUserId`, `mintSignInToken`) so the
  server path is unit-tested without touching Clerk; the client redemption (`useSignIn` ticket →
  `setActive`) leans on live acceptance (no jsdom/RTL harness in `apps/web`).
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
- **ORM/DB: Drizzle ORM + PGlite for dev/test, Postgres (Neon) for prod.** Spec offers
  "Prisma OR Drizzle". Chose Drizzle because its PGlite integration runs *real Postgres
  in-process*, so the append-only ledger trigger and permission joins are exercised by tests
  with zero server to provision — the load-bearing invariants become genuinely testable. Same
  Postgres dialect ships to any vanilla Postgres unchanged.
  - **Prod target: Neon (was Supabase).** We deliberately unbundled — Clerk for auth, R2 for
    storage, Inngest for the queue, all behind seams — so Supabase's integrated BaaS value
    (Auth/Storage/Realtime/auto-API) would be paid for and ignored, and partly *conflict*: its
    idiomatic Row-Level Security model runs against our load-bearing **single front door**
    (authorization lives in `@chronicle/core` app code, never in the DB). Neon is "just
    Postgres," which matches the commodity-Postgres-behind-Drizzle philosophy. It also fits the
    dev workflow: copy-on-write branches per PR/preview, scale-to-zero (≈free at idle for a
    low-traffic family app), and a serverless HTTP driver for Next.js. PGlite remains the
    dev/test DB; nothing about the schema or invariants changes.
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
- **Email default: Resend**, behind the `@chronicle/notifications` `Notifier` interface. SDK
  usage confined to `packages/notifications/src/resend.ts`; mock in tests.
- **SMS default: Twilio**, behind the same `Notifier` interface. SDK usage confined to
  `packages/notifications/src/twilio.ts`; mock in tests. Both adapters are enforced by the
  vendor-SDK architecture guard in `packages/pipeline/test/pipeline.test.ts` (`roots` now
  includes `packages/notifications/src`; `resend`/`twilio` are forbidden imports outside their
  named adapter files).

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
- **Prod Postgres (Neon) — `Database` type narrowed so `db.query.stories` is a COMPILE
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

## Schema-parity check: deploy gate, not runtime guard (2026-07-02)

- **Context.** `applySchemaToPostgres` is bootstrap-only (no-ops once `persons` exists), so schema
  objects added after first boot never reach a live Neon DB — prod drifted (missing
  `stories.originating_family_id`, `story_families`, `intake_answers`, `intake_origin`,
  `media_kind='intake_audio'`) and 500'd at query time with Postgres 42703. The first fix
  (commit `a9a9bd8`) added `assertPostgresSchemaParity` and called it **unconditionally on every
  cold start** in `apps/web/lib/runtime.ts`.
- **That runtime placement caused a worse outage.** The guard calls `schemaSql()`, which
  `readFileSync`s `packages/db/drizzle/{schema,invariants}.sql`. Next's file tracer (`@vercel/nft`)
  does not follow a `readFileSync(fileURLToPath(new URL(...)))` read, so those assets were absent
  from the Vercel serverless bundle → the guard threw `ENOENT ... schema.sql` on **every** cold
  start → `/auth/callback` caught it and bounced every sign-in / create-family / hub load to
  `/sign-in?error=callback`. A request-path guard turns *any* failure into a total-app outage — a
  strictly larger blast radius than the targeted 42703 it was meant to catch.
- **Decision.** The parity check **moved out of the request path and onto the deploy gate**
  (`apps/web/vercel.json` → `buildCommand: "pnpm --filter @chronicle/db db:check-parity && next build"`,
  script `packages/db/scripts/check-parity.ts`). Drift now fails the **build**, so a schema-behind
  database can never reach production — and it can never take down a running app. The check runs
  once per deploy against the live Neon branch via `DATABASE_URL`, and **fails loud** if
  `DATABASE_URL` is absent (a gate that can't verify must not pass).
- **Prerequisite.** `DATABASE_URL` must be present in the Vercel **build** env for each deploying
  target (Production has it; add it to Preview if preview deploys should also be gated).
- **Defense-in-depth kept.** `outputFileTracingIncludes` in `next.config.mjs` still force-bundles
  the `.sql` files, because `schemaSql()` is *also* read at runtime by the opt-in
  `CHRONICLE_RUN_MIGRATIONS=1` fresh-DB bootstrap — a latent ENOENT trap on any serverless target
  without the trace include.

## Migrations: forward migration chain for durable DBs, snapshot kept for dev/tests (2026-07-04)

Full design: `docs/superpowers/specs/2026-07-04-db-migrations-design.md`. This supersedes the
"single-schema, no incremental migrations while the schema is molten (2026-06-28)" decision above
for **durable** environments, and retires the parity-gate-only / boot-bootstrap model from the
schema-parity section — dev and tests are unchanged.

- **Two artifacts, one source of truth.** `schema.ts` stays the single source of truth (too embedded
  — the single front door, re-exported domain types — to dethrone; we never introspect the schema
  back from a DB). It derives (a) the **snapshot** (`drizzle/schema.sql` + `drizzle/invariants.sql`,
  applied wholesale by `applySchema`/`resetSchema` — the fast path for PGlite tests and the dev seed,
  freely rebuilt) and (b) the **migration chain** (`drizzle/migrations/NNNN_*.sql` + `meta/`, applied
  incrementally and tracked in `__drizzle_migrations` — the durable, never-destructive path for Neon).
- **Engine = drizzle-kit (already installed); not rolled our own.** Postgres has no native migration
  tool and Neon is just managed Postgres; `drizzle-kit generate` + `drizzle-orm`'s `migrate()` is a
  real journal-tracked, checksummed system. Atlas (the one tool that models triggers as first-class)
  was considered and rejected as overkill / a competing toolchain for this stage.
- **Drift guard bonds snapshot ≡ chain (`packages/db/test/migration-drift.test.ts`).** Builds one
  PGlite from the snapshot and one by replaying the chain from empty, introspects both via `pg_catalog`
  (columns, enums, indexes, constraints, triggers, functions) and asserts identity. Because it compares
  actual DB state, not drizzle's partial model, it covers the invariants drizzle can't model — so the
  canonical error "added an index to `invariants.sql` but forgot the migration" turns CI red before
  anything reaches Neon.
- **Invariants are hand-carried into migration files.** Drizzle-kit (like every schema-diff tool)
  cannot model triggers / functions / partial unique indexes. The baseline `0000_baseline.sql` inlines
  the full current `invariants.sql`; future invariant changes are hand-appended to the migration that
  needs them. `db:generate` now emits BOTH artifacts in one command (regenerates `schema.sql`, then
  `drizzle-kit generate` for the incremental migration); a CI drift step
  (`db:generate && git diff --exit-code -- packages/db/drizzle`) fails on an uncommitted snapshot/migration.
- **Migrate at build, not at boot.** `runMigrations` (`src/run-migrations.ts`) + the `db:migrate` CLI
  run in the Vercel `buildCommand` (`db:migrate && db:check-parity && next build`) against the
  deployment's Neon branch — advancing the branch non-destructively before the app build. This replaces
  the old parity-gate-that-only-failed-the-deploy and removes the bootstrap-only `applySchemaToPostgres`
  and the `CHRONICLE_RUN_MIGRATIONS` boot path; `runtime.ts` no longer applies schema on boot. The
  parity check is retained as a post-migrate assertion (belt-and-suspenders).
- **One-time destructive Neon baseline reset (safe now).** Standing up the chain required a single
  `DROP SCHEMA` reset of both Neon branches to re-stamp them at `0000`. Safe only because no critical
  data exists yet — the whole point of doing this now, while blow-away is still a viable fallback, so
  the workflow is battle-tested before the first real user makes it load-bearing.
- **Residual risk: `runMigrations` itself is untested.** `runMigrations` (`src/run-migrations.ts`) is
  the real Neon apply path (drizzle's postgres-js `migrate()`), but has no automated test coverage —
  the suite has no external Postgres and PGlite can't back the postgres-js migrator. The drift guard
  exercises a parallel hand-rolled replay (`replayMigrationsFromEmpty`), not `migrate()` itself, so a
  defect in `runMigrations` / its migrations-folder resolution / the `as never` cast would first
  surface in a Vercel build rather than in `pnpm test`.
- **Deferred (recorded so they're choices):** per-PR isolated Neon branches (previews share the dev
  branch); a separate release-step GitHub Action (migrate stays in `buildCommand`); Atlas / any
  non-drizzle engine; down/rollback migrations (forward-only — roll back by writing a new forward
  migration); data-transformation/backfill migrations (none needed; the hand-authored SQL format
  already supports them).

## Family scope selector: create/join any time, multi-family hub (2026-07-05)

Full design: `docs/superpowers/specs/2026-07-05-family-scope-selector-design.md`; plan:
`docs/superpowers/plans/2026-07-05-family-scope-selector.md`.

- **Create-a-family and request-to-join are always-available in-app actions, not one-time
  onboarding stops.** The router's "park a pending-only user on `/families/find`" fork is gone
  (see Gate C below); create/join now live permanently at the bottom of the hub scope selector,
  reachable by any authenticated user in every non-zero-relationship state. Cold-start (zero
  membership AND zero pending request) still routes to `/families/start`, unchanged. This makes
  ADR-0001's discovery/join flows repeatable rather than reachable only before you join a family.
- **Routing Gate C deleted (pending-only → hub, not `/families/find`).** `resolvePostAuthRoute`
  no longer parks an onboarded-but-awaiting-approval user on the find screen. Gate A (zero
  relationship → `/families/start`) and Gate B (has intent but not onboarded → `/welcome`) stand;
  everyone past cold-start — member OR pending-only — falls through to `/hub`, and the `/hub`
  guard is relaxed to admit pending-only viewers (who get a coherent empty-state hub). A regression
  pins the pending-only → `/hub` route.
- **One unified server-read `?scope=` param is the single family-scope control; the per-tab
  controls were retired.** The hub header's `[ All ▾ ]` selector (`apps/web/app/hub/HubScopeSelector.tsx`)
  owns everything "family" — rows for `All` + each active family, muted pending-join rows (open a
  status/withdraw view, never become a scope), and pinned `+ Create a family` / `Find a family to
  join` actions. Scope lives in the URL (`?scope=all|<familyId>`, default `all`), validated in
  `hub/page.tsx` against the viewer's own active families with a **leak-safe fallback to `all`**
  (a `?scope=` for a family you're not an active member of never returns its content). This replaced
  the pre-existing per-tab controls — Stories' client-side `?scope=` and Album's `?family=` were
  hoisted into this one server-read param — and removed the dead `manage-family` account-menu stub
  (the avatar menu stays purely account-level).
- **Per-tab scope semantics: reads take a deduped union in `All` and filter to one family when
  scoped; writes/steward acts resolve a single target.** A read item tagged to N families (Stories,
  Album, Asks) appears **once** in `All` (deduped by id) and in each of its families' scoped views
  (scoping is a membership test against the tag set). Ask compose has a family multi-select seeded
  from scope (requires ≥1 family, server-guarded). Invite is single-family: an explicit pick is
  forced in `All` when the inviter is in >1 family, resolved server-side by `resolveInviteFamilyId`,
  and the tab is hidden / empty-stated for a member-of-none. Requests filters by scope and, in `All`,
  aggregates pending requests across every family you steward with per-family row labels (a
  multi-family steward shouldn't have to switch scopes to notice a request elsewhere).
- **Asks joined the N-family content model via `ask_families`; relationship acts stay
  single-family.** The single nullable `asks.familyId` was replaced by an `ask_families` M2M join
  table mirroring `story_families` (ADR-0010); `createAsk` now takes `familyIds: string[]`, story
  approval unions the answered ask's families into `story_families`, and `eraseAsk` gathers stewards
  across all of the ask's families. Migration `0003_equal_master_mold.sql` (create join table →
  backfill one row per existing ask from its legacy non-null `family_id` → drop the column) applies
  to Neon at deploy like `0001`/`0002`; the snapshot was regenerated so the drift-guard stays green.
  `invitations.familyId`, `joinRequests.familyId`, and `memberships.familyId` stay single-FK — they
  are relationship acts, not content.
- **Story family targets are chosen at the SHARE step, not compose time (`feat/multi-family-picker`,
  2026-07-05).** Retires the earlier "story-compose has no family-target picker (deferred)" note: the
  ADR-0010 story multi-target picker is now wired at the share/review step for self-authored tellings
  AND answers to asks (shared `<FamilyPicker>`, also backing the ask and album pickers). The decision
  is to make the family choice at *share* — the point where consent is granted — rather than at
  compose time, so an author picks audience alongside the decision to share at all. The picker's
  candidate set is bounded by the **author's own** active memberships (server-resolved by
  `resolveComposeFamilies`), seeded from the answered ask's families (answers) or hub `?scope=`
  (tellings); a single-family author sees no picker (auto-resolved), an ambiguous case forces an
  explicit pick. Core does not trust the UI: `approveAndShareStory` takes the chosen set as an
  explicit `familyIds` param that, when non-empty, **replaces** `computeDefaultFamilyTargets`,
  **re-validates** every id against the owner's ACTIVE memberships, and writes `story_families` in the
  same transaction (shared `replaceStoryFamilyTargetsTx`, now also backing `setStoryFamilyTargets`).
  The auto-derived default still governs when no explicit set is supplied. No leakage-suppression
  display gate was built — no answer-story renders its originating question in any feed, so that
  concern was found MOOT.

## Who may edit a Person record (tree Slice C, 2026-07-15)

- **Cross-person identity editing is gated by ONE predicate (`canEditPerson`), never scattered.** The
  details sheet's new **Edit** affordance is the first cross-person write. A viewer may edit a Person's
  identity fields (`displayName`, birth/death dates, `sex`, `lifeStatus`; `spokenName` self-only) when
  ANY of: **self**, **creator** (new immutable `persons.createdByPersonId` provenance, set on every
  mint — `addRelative` relatives + bridges, invitee mint), **steward** of a family the person actively
  belongs to, or **deceased → any active family member** (collaborative ancestor maintenance). A
  *living, non-self* person is editable only by steward/creator; anonymous/non-member never. The UI gate
  (a server-projected `editable` flag) and the write choke point (`updatePersonIdentityAsEditor`, which
  re-checks `canEditPerson` and throws `AuthorizationError`) share the same predicate so they can't
  diverge. No new ledger (identity edits aren't kinship assertions); a per-field audit ledger is a noted
  follow-up. Full rationale + accepted deceased-carve-out risk in
  `docs/adr/0021-who-may-edit-a-person-record.md`.

## Gap-driven follow-up + first prompt-as-data realization (issue #80, 2026-07-16)

- **The interviewer's follow-ups are now gap-driven, WITHIN the controlled loop (not open chat).**
  After a narrator answers, a THIN extraction pass (`interviewer/gap-detection.ts`) names at most a
  few missing/ambiguous facts (`temporal | relational | spatial | causal | identity`) as short
  seeds. It PROPOSES only — it decides nothing about flow, exactly like `follow-up-evaluator.ts`.
- **Composes with the existing follow-up machinery instead of a parallel path.** Each gap maps to
  the existing `FollowUpCandidate` shape (`gapsToFollowUpCandidates`), so the ALREADY-built gate
  stack in `decideFollowUp` (thin-answer floor, distress/off-ramp short-circuit, rapport gate,
  anti-repeat, confidence floor, per-thread/session caps, emotional-door veto) disposes of gap
  follow-ups with ZERO duplicated policy. A `createGapFollowUpEvaluator(llm)` implements the same
  `FollowUpEvaluator` seam the answer-surface already consumes.
- **Slots at the SAME priority as the existing follow_up intent.** We EXTENDED the `follow_up`
  `PromptIntent` with `origin: "reflection" | "gap"` (+ `gapKind`) rather than adding a sibling
  intent kind. Rationale: a sibling kind would duplicate the slot-5 priority logic in
  `pickNextIntent` AND the phraser's follow_up rendering block; extending reuses both, and the
  controlled-loop ordering + one-question-at-a-time rule are preserved unchanged. The turn loop
  runs detection in `recordResponse` (gated: skipped on distress/off-ramp, and below a word floor),
  disposes via `decideFollowUp`, and QUEUES the winner as `state.pendingGapFollowUp`; the picker
  emits it at the follow_up slot on the next turn. A gap can therefore NEVER push into pain — slot 0
  returns `wind_down` on distress/off-ramp before the queued gap is ever reached.
- **This is the FIRST realization of the deferred "prompts are data" target design above.** Per
  that section's contract/wording split: the OUTPUT CONTRACT (the JSON shape + the `GapKind` enum +
  the defensive parser) stays in code (`gap-detection.ts`); the WORDING lives in a small versioned
  data module (`interviewer/prompts/gap-prompts.ts`) keyed `purpose → vendor → version`, resolved
  at runtime by `resolveGapPrompt({vendor, version})`. We deliberately did NOT build heavy
  runtime-registry infra — a typed const store is the right scope for one prompt. The gap follow-up
  is PHRASED by the existing (already-versioned) `phraser.ts`, so it introduces no second new
  prompt. When the next prompt or a real vendor variant lands, this module is the seam to grow.

## Workflow

- **Subagent-driven build + fresh adversarial review.** Coding sub-agents write the code; the
  main agent orchestrates. When a coding sub-agent finishes a task, it (or the main agent) spawns
  a *separate, cold, fresh-eyes* adversarial code-reviewer sub-agent. The coding sub-agent then
  consumes that review output and iterates on its own code until the review comes back clean,
  with a *new* reviewer each round. This supersedes the earlier "sub-agents are review-only; lead
  engineer writes all code" rule (corrected 2026-06-27) and the general "use Agent Teams"
  preference. Net: coding agents both write and fix; reviewers are independent and per-round.

### Test execution & merge gates (who runs the suite, when)

Decided 2026-07-17. The suite was being executed up to three times per task — builder, reviewer,
then main agent — which is slow and token-expensive. The rule below assigns each actor exactly the
work it is uniquely good at, and settles pass/fail in the cheapest place that can be trusted.

Where the vitest suite (and the rest of the matrix) actually runs today:

| Path | lint | typecheck | **test** | build | drift |
|---|---|---|---|---|---|
| **PR** (`.github/workflows/ci.yml`, `on: pull_request`) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Direct push to master** (deliberate fast-path) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Vercel build** (`vercel.json` buildCommand) | ❌ | partial¹ | ❌ | ✅ | partial² |

¹ `next build` only typechecks code reachable from the `apps/web` build graph; a broken
`@chronicle/core` invariant that still compiles and isn't imported there ships clean.
² `db:check-parity` runs (snapshot-vs-Neon), but not the drift-guard **unit test**.

Rules:

- **Builder sub-agent runs tests for its own red-green loop.** Necessary — that's how it knows to
  iterate. It reports its final test output as an artifact.
- **Reviewer sub-agent does NOT re-run the full suite.** Its inputs are the diff, the builder's
  reported test output, and (on a PR) CI status. Its job is judgment CI can't do — correctness,
  spec-adherence, security, convention, and whether the tests are *adequate*. It MAY run a
  **narrow, targeted** test when it has a specific hypothesis ("this edge case looks uncovered" →
  run that one test, or write a failing one). A blind full re-run is not review; it's redundant
  execution.
- **PR path: CI is the authoritative pass/fail gate.** It runs lint/typecheck/test/build/drift as
  parallel matrix legs, off the dev machine, for free. On this path the main agent does not need a
  final re-run — CI settles it.
- **Direct-push-to-master path: the main agent MUST run the full local preflight before pushing**,
  because nothing else does. Vercel runs `next build`, *not* the suite. The preflight mirrors CI's
  matrix, not just `test` (gating only `test` leaves lint/typecheck/`next build`/drift holes on the
  one path with no CI — the exact failure modes ci.yml's comments were written over):
  ```
  pnpm -r lint && pnpm -r typecheck && pnpm -r test && pnpm --filter @chronicle/web build \
    && pnpm --filter @chronicle/db db:generate && git diff --exit-code -- packages/db/drizzle
  ```
- **Why direct-push exists:** free-plan GitHub CI is ~12 min (dominated by 5× cold
  `pnpm install --frozen-lockfile` on fresh runners + queue wait, not test compute); local pays
  install once and can run legs concurrently. **Smell test:** if you run the full preflight above
  routinely, the fast-path isn't buying much over just opening a PR and letting CI do it in
  parallel — prefer a PR for anything non-trivial.

## Invite delivery (email/SMS) — vendor choice + a deliberate invariant weakening

Decided 2026-07-17. Spec: `docs/superpowers/specs/2026-07-17-invite-delivery-email-sms-design.md`.

- **Resend (email) and Twilio (SMS) are the default adapters behind a new `Notifier` seam**
  (`@chronicle/notifications`). Both vendor SDKs are confined to `resend.ts`/`twilio.ts`
  respectively; nothing else in the package (or any other IP package) may import them, enforced by
  extending the existing vendor-SDK architecture guard (`packages/pipeline/test/pipeline.test.ts`)
  to scan `packages/notifications/src`, with `resend.ts`/`twilio.ts` carved out exactly like
  `packages/storage/src/r2.ts` is for `@aws-sdk/*`.
- **Async (Inngest) delivery was chosen over an inline send**, which forces a deliberate,
  accepted weakening of the standing "the raw invite token is never persisted" invariant: the
  plaintext token is placed in the Inngest job payload so the off-request-path worker can build
  the join link. Normally the raw token lives only in the emailed/texted link itself; only its
  SHA-256 hash is stored in the DB. An async worker has no other way to reconstruct the link once
  it's off the request path, so the payload becomes a second place the plaintext token exists
  (at rest, in Inngest's job store) for the (short) lifetime of the job.
  **Superseded 2026-07-18 (issue #103):** the token is now envelope-encrypted (AES-256-GCM under
  a server-held `INVITE_TOKEN_ENC_KEY`) before enqueue, so the persisted payload carries only
  ciphertext and the worker opens it in memory to build the link — "leak ≠ working invite" is
  restored. `INVITE_TOKEN_ENC_KEY` is boot-required whenever `INNGEST_EVENT_KEY` is set (see
  `assertInngestServeable`); the inline path (Inngest unset) never seals and needs no key.
  - **Rejected alternative 1 — inline send.** Sending synchronously on the request path preserves
    the invariant natively (the token never leaves process memory except inside the rendered
    message). Rejected because the user explicitly chose async delivery via Inngest — request
    latency and vendor-outage isolation for email/SMS sends outweighed keeping the invariant
    intact for free.
  - **Rejected alternative 2 — envelope-encrypt the token in the payload.** Encrypting the token
    before putting it in the job payload (and decrypting only in the worker) would preserve
    "a leaked payload ≠ a working invite," closing the gap the plaintext choice opens. Rejected
    for this iteration as added complexity (key management for a payload-level envelope) not
    justified yet; noted here so it's a conscious, revisitable deferral rather than an
    overlooked gap. **Adopted 2026-07-18 (issue #103)** — see the superseding note above.
