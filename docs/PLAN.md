# PLAN — Phase 0 + Phase 1 Build Checklist

Derived directly from the spec's **Part VI — Build sequence**. Each increment runs the
loop: **BUILD (code + tests) → adversarial fresh sub-agent eval → ENHANCE → re-eval with a
new fresh sub-agent until no spec violations remain → next increment.**

Status legend: ⬜ not started · 🔨 in progress · ✅ done (eval-clean)

## Increment 0 — Repo & toolchain scaffold (enabling work, not in the spec sequence)
- [x] git init, monorepo layout (pnpm workspaces)
- [x] paper-trail docs (PLAN/DECISIONS/PROGRESS/OPEN-QUESTIONS)
- [ ] root tsconfig, lint, test runner (Vitest), workspace packages
- [ ] DB layer: Drizzle + PGlite (real Postgres in-process for tests)

## Increment 1 — THE SPINE  🔨
The data model + the single front door + the append-only ledger.
- [ ] Drizzle schema: Person, Account, Family, Membership, Story, Media, ConsentRecord, Ask
- [ ] Enums/states exactly per Part II (Story state, audienceTier, Membership role/status,
      Media kind, ConsentRecord action, lifeStatus, Ask status)
- [ ] Append-only consent ledger: DB trigger blocking UPDATE/DELETE + repository that only
      appends; revocation = new row
- [ ] The single authorization function (4-tier check, resolves owner's active memberships)
- [ ] Ownership invariant: Person owns all expressive content; Family owns nothing expressive
- [ ] Tests: authorization matrix, ledger append-only (trigger + repo), no-bypass read path

## Increment 2 — CAPTURE PATH (web link, end to end)  ✅
- [x] Session token → narrator Person + Family context (no login, token IS identity) — `@chronicle/capture` sessions, hashed tokens, expiry/revoke
- [x] Thin capture web page: greeting, one start control, listening state, one stop — `apps/web` `/s/[token]`
- [x] In-browser audio capture (wideband); source-agnostic capture adapter (telephony seam) — `CapturedAudio` + `CaptureSource`, `ingestRecording`
- [x] Immediate immutable persistence of `story_audio` Media (before any processing) — `ingestRecording` uploads bytes, then core write path
- [x] Draft Story created pointing at the canonical Recording — `persistRecordingAndCreateDraft`
- Note: browser mic capture + dev-server E2E is unverified in this headless env (no browser/mic). Service layer fully tested; UI typechecks + builds.

## Increment 3 — PIPELINE (transcribe → speech-to-story)  ✅
- [x] Durable, staged, idempotent flow behind JobQueue interface (in-proc impl; Inngest seam = same interface)
- [x] Working-copy transforms (DSP stubbed behind `WorkingCopyTransformer`): segment table reports
      `originalStart/EndMs` ↔ `workingCopyStart/EndMs` so timestamps map back to 1x via
      `mapWorkingCopyMsToOriginalMs`. Default speedFactor 1.6, low-SNR backoff 1.4, hard cap 2.0.
      **Canonical audio is a separate Uint8Array — never mutated.**
- [x] `Transcriber` interface + `ScriptedTranscriber` mock (Groq Whisper Turbo default in DECISIONS)
- [x] `LanguageModel` interface + `ScriptedLanguageModel` mock (Anthropic Claude default);
      speech-to-story prompt + parse live in our code (`render-story.ts`)
- [x] draft → pending_approval via `assertStoryTransition` (the deferred guard is now wired);
      audienceTier stays `private`; prose/transcript regenerable (clear field → re-run = new render)

## Increment 4 — INTERVIEWER BEHAVIOR (the IP)  ✅
- [x] Controlled turn loop wrapping the LLM (NOT an open chat) — `@chronicle/interviewer`
- [x] Behavior policy in our code: open/concrete/non-leading, one-at-a-time, silence-tolerant,
      reflect/follow, gentle sequencing, reminiscence-bump weighting, spoken off-ramp
- [x] Four turn inputs: base question bank, pending Asks (prioritized, asker named),
      session memory, biographical anchors
- [x] Cross-session memory + warm callback — via NEW audited core read
      `listNarratorMemoryForInterviewer` (SQL-projection-only: title/summary/tags/promptQuestion/
      createdAt; no transcript/prose/storageKey ever selected). On `story-repository.ts` which
      is already in the architecture-test allowlist.
- [x] Voice interface (ElevenLabs default per DECISIONS) + `ScriptedVoice` mock

## Increment 5 — VOICE-ONLY APPROVAL GATE  ✅
- [x] Voice approval in-session; capture `approval_audio` Media — `captureApproval` in `@chronicle/capture` (storage-first ordering mirrors `ingestRecording`)
- [x] Atomic: Story pending_approval → approved → shared @ chosen tier + first ConsentRecord — `approveAndShareStory` (audited core write); one `db.transaction`, both state legs through `assertStoryTransition`, intermediate `approved` row persisted
- [x] Voice correction regenerates prose only; audio untouched — `applyTranscriptCorrection` (core) + `applyVoiceCorrection` (pipeline coordinator); recording pointer structurally unreachable from these seams
- [x] Authorization function refuses to surface Story without approved/shared + backing ledger row — regression covers full lifecycle (pending→shared@family→revoked)

## Increment 6 — BASIC FAMILY HUB  ✅
- [x] Logged-in account-holder surface; approved-stories list (original voice primary, prose secondary) — `/hub` server component, audio rendered first with prose in `<details>` collapsed by default
- [x] Invite-link generator (creates session token) — `/hub/invite` via audited `createLinkSession`; raw token handed to result page via short-lived httpOnly flash cookie (NEVER via URL query — would leak via logs/history/Referer)
- [x] Ask submission — `/hub/ask` via new `@chronicle/core` `createAsk` (co-membership gated; non-anonymous; non-empty; spoofed-familyId rejected)
- [x] All reads strictly through the authorization function — hub feed via `listStoriesForViewer`; `/api/media/[id]` via `getMediaForViewer` (404 indistinguishable from "no access")

## Increment 7 — ASKED-QUESTION RELAY (self-feeding loop)  ✅
- [x] Ask queued → routed into interviewer queue (one of several prompt sources = seam) — `createCoreAskSource` adapter calls `listPendingAsksForNarrator` + `markAskRouted`; turn loop calls `askSource.markRouted` after `ask` intent
- [x] Prioritize + frame warmly with asker named; buffered, never interrupts narrator — already in `behavior.ts`/`phraser.ts` from I4; `/api/capture` accepts optional `askId` to bind a recording to an Ask
- [x] On approval: Ask → answered + Story pointer; deliver answer back to asker (hub notification) — `approveAndShareStory` atomically flips a linked Ask to `answered` (status + storyId + answeredAt) in the SAME tx as the consent ledger entry; `/hub/asks` shows the asker their submitted Asks with status + `getStoryForViewer`-gated link to the answered Story

## Increment 8 — IN-HUB ANSWER → APPROVE LOOP (no links but sign-in)  ✅
Goal: signed-in Eleanor answers questions from her queue, relisten/re-record, taps to approve;
pipeline runs only on approval; magic link = passwordless account login to the same flow.
Decisions: ADR-0002 (consent-scoped media immutability + hard-delete), ADR-0003 (magic-link =
account login), ADR-0004 (tap approval, no voice). See CONTEXT.md (Draft, Magic link).

**Shared contracts FIRST (blocking — interdependent code; per global pref):** — done as Wave 0
- [x] `MediaStorage.delete(key)` added to the interface + all 3 adapters (idempotent).
- [x] Capture identity union `CaptureActor = { kind:"account"; personId } | { kind:"link_session"; token }`.
- [x] `approveAndShareStory` input: `approvalAudio` is OPTIONAL; result `approvalAudio: Media | null`
      (tap approval → consent row `approvalAudioMediaId` NULL).
- [x] Outstanding-draft read — implemented as `listOutstandingAnswerDrafts(db, narratorPersonId)` in the
      ALREADY-allowlisted `story-repository.ts` (the asks query in `asks.ts` cannot read the guarded
      `stories` table without breaking the front door; web merges the two). DEVIATION from the literal
      "extend the asks row" wording — front-door-safe, and needs **no allowlist change**.

**Domain:**
- [x] DB: media-immutability trigger now consent-scoped (ADR-0002) via `chronicle_media_delete_guard`:
      DELETE allowed only when the media is unreferenced by any `consent_records` AND its Story has no
      `consent_records`; UPDATE always forbidden. PLUS hardening (review): `stories.recording_media_id`
      is now itself immutable (a trigger), so a consented story's recording can't be re-aimed then orphaned.
- [x] Storage: `delete` implemented in filesystem (`rm force`) / R2 (`DeleteObject`) / in-memory.
- [x] Core: `discardDraftStory` audited path — verify draft + owner + zero consent rows → delete story
      row then media row in-tx (DB-row-first) → return storageKeys; caller best-effort deletes blob.
      Placed in `story-repository.ts` (already allowlisted) → **architecture allowlist UNCHANGED**.
- [x] Core: `approveAndShareStory` honors optional approvalAudio; draft-state read added (above).
- [x] Capture: `ingestRecording`/`captureApproval` identity-agnostic via `resolveCaptureActor` (resolve
      token OR trust upstream-authed account personId, with a phantom-id existence check); `/s/[token]`
      unchanged.
- [x] Pipeline: real Groq/Anthropic adapters (pre-existing `@chronicle/{transcribe-groq,llm-anthropic}`
      packages) wired in `runtime.ts` via a keys-present-vs-mock switch; runtime exposes `newPipeline()`
      — a per-call FACTORY (not a singleton) so concurrent in-hub approvals never share one in-proc queue.

**Web:**
- [x] Magic-link route `/a/[token]/[askId]` (a GET Route Handler — only handlers/actions may set cookies):
      resolve token → if the Person has an Account, `auth.establishAccountSession` → redirect
      `/hub/answer/[askId]`; no-account/invalid-token/already-signed-in handled; warm degrade to `/s/[token]`.
      NOTE: the mock adapter implements session establishment; the **Clerk** adapter throws a documented
      Phase-1 not-supported (needs Clerk sign-in tokens) and the route warns + degrades — a known seam.
- [x] `/hub/answer/[askId]` (account-authed, full-screen): record → review. Authed capture via a server
      action (personId from the session, never the client). Review = relisten (`/api/media`), re-record
      (discard prior draft → record), discard, tier picker + **Share** → pipeline INLINE
      ("Putting your story together…") → `approveAndShareStory` (tap) → `/hub`.
- [x] Questions tab: per-ask two-state (Answer vs Review & approve + recordedAt), both link to the answer
      page. `AnswerButton` stub deleted.
- [x] Dev switch-user: `/dev/sign-in` one-click "Become X" buttons per seeded account-holder.
- [x] Seed: `/dev/seed` surfaces only sign-in + seeded credentials; stops surfacing Eleanor's link token;
      seeds ~4 asks for Eleanor + one `draft` linked to an ask (immediate "Review & approve"); keeps the
      approved feed stories.

**Regression (per global pref):** — green
- [x] Trigger: never-consented draft media DELETE allowed; consented recording/approval-clip DELETE
      raises; UPDATE always raises; recording-pointer change raises.
- [x] `discardDraftStory` refuses non-owner / non-draft / consented story; identity-agnostic capture
      (account happy-path + IDOR-denied + phantom-id; token path unchanged); in-hub approve runs pipeline
      → `shared` (tap); answered-ask record refused; outstanding-draft query.

Gates: `pnpm -r typecheck`, `pnpm -r test` (all packages), `pnpm --filter @chronicle/web build` all green;
architecture allowlist canaries unchanged. Two adversarial cold-reviewer passes (trigger+capture, answer
flow) → all findings closed.

## Increment 9 — REAL CLERK AUTH  ⬜
Turn on the production identity adapter. The Clerk seam is already scaffolded (`auth-clerk.ts`
resolves session→userId→Account→Person; `clerk-config.ts`/`runtime.ts`/`layout.tsx`/`middleware.ts`
gate on `isClerkConfigured()`). This increment fills the four real gaps: provisioning, the hosted
sign-up/in UI, the invitation rework, and the magic-link sign-in-token path. Decisions:
ADR-0005 (JIT provisioning), ADR-0003 §"Clerk implementation" (sign-in tokens), DECISIONS.md
(dev-runs-Clerk, Clerk-mode seed).

**Slice 0 — manual prerequisite (Clerk dashboard, no code):**
- [ ] Set **Name → required** (User & Authentication → Personal information).
- [ ] Create test users for the seed personas (Sofia, Marco, …) with the **same emails** the seed uses.

**Slice 1 — core Clerk loop.**  *Acceptance: sign up via Clerk → `/auth/callback` provisions →
`/welcome` → DOB → `/hub`, verified live on the dev Clerk instance.*  *PROD KEYS STAY OFF.*
- [ ] Env: `sk_test_`/`pk_test_` into `apps/web/.env.local` (NOT repo-root `.env`); confirm
      `isClerkConfigured()` flips and the Clerk adapter is wired.
- [ ] `/sign-in` + `/sign-up` → optional catch-all `[[...]]`; conditional render (Clerk
      `<SignIn/>`/`<SignUp/>` when configured, existing mock form otherwise); `forceRedirectUrl`
      → `/auth/callback`. Themed via Clerk `appearance` (cosmetic, can defer).
- [ ] `/auth/callback` — the single post-Clerk landing: JIT provision (`clerkClient().users.getUser`
      → `createAccountWithPerson`, idempotent on duplicate `authProviderUserId`) → apply pending-invite
      cookie if present → `resolvePostAuthRoute`.
- [ ] Middleware matcher — VERIFY against Clerk v6 docs first; broaden for `/__clerk/:path*` + the auth
      routes; **keep `/s/[token]` and `/a/[token]` excluded** (existing carve-out).
- [ ] `/join/[token]` rework — anonymous branch sets httpOnly pending-invite cookie {token,
      relationshipLabel} → Clerk sign-up → `/auth/callback` accepts + clears cookie. Signed-in
      direct-accept path preserved. Relationship label stays collected up front.
- [ ] Sign-out — custom Kindred control; Clerk-configured → client `useClerk().signOut({redirectUrl:'/'})`,
      else existing mock server action. No `<UserButton/>`.
- [ ] Clerk-mode seed — bind personas to real Clerk users by `getUserList({ emailAddress })`; store real
      `userId` as `authProviderUserId`; skip `mock_auth_users` insert; skip-with-warning if unmatched.
      Seed stays authoritative for persona `displayName`/`spokenName`.
- [ ] Regression: JIT provision idempotency + concurrent-landing race; `/auth/callback` pending-invite
      apply; route mode-switch (Clerk vs mock).

**Slice 2 — magic-link via Clerk sign-in tokens.**  *Acceptance: mint a sign-in token → redeem →
land authed on `/hub/answer/[askId]`.*  **GATE: prod Clerk keys may go live only after this slice.**
- [ ] `/a/[token]/[askId]` (Clerk path) — mint `clerkClient().signInTokens.createSignInToken({ userId })`
      → redirect to redemption route. Mock path unchanged.
- [ ] `/auth/redeem` — client route: `signIn.create({ strategy: 'ticket', ticket })` → forward to dest.
- [ ] Remove the throws-and-degrades branch for the Clerk adapter's `establishAccountSession` seam.
- [ ] Regression: ticket lands the correct Person on `/hub/answer/[askId]`; expired/invalid ticket
      warm-degrades to `/s/[token]`.

## Seams to leave UNBUILT (Appendix) — verify each increment doesn't foreclose them
branch-level audience · time-gated release · telephony channel · external-record enrichment /
timeline-map-tree · steward console & succession · avatar consent gate & story-will ·
broader engagement-trigger catalog.
