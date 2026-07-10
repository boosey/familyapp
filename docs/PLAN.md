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

**Slice 1 — core Clerk loop.**  🔨 *code-complete + all automated gates green (typecheck/test/build);
LIVE acceptance on the dev Clerk instance + env wiring still PENDING the dev Clerk keys.*
*Acceptance: sign up via Clerk → `/auth/callback` provisions → `/welcome` → DOB → `/hub`, verified
live on the dev Clerk instance.*  *PROD KEYS STAY OFF.*
- [ ] Env: `sk_test_`/`pk_test_` into `apps/web/.env.local` (NOT repo-root `.env`); confirm
      `isClerkConfigured()` flips and the Clerk adapter is wired.  *(USER STEP — needs the dev Clerk
      keys; code reads them already, `isClerkConfigured()` covered by unit tests.)*
- [x] `/sign-in` + `/sign-up` → optional catch-all `[[...]]`; conditional render (Clerk
      `<SignIn/>`/`<SignUp/>` when configured, existing mock form otherwise); `forceRedirectUrl`
      → `/auth/callback`. Themed via Clerk `appearance` (cosmetic, can defer). — `app/sign-in/[[...sign-in]]`,
      `app/sign-up/[[...sign-up]]`; old non-catch-all pages deleted.
- [x] `/auth/callback` — the single post-Clerk landing: JIT provision (`clerkClient().users.getUser`
      → `createAccountWithPerson`, idempotent on duplicate `authProviderUserId`) → apply pending-invite
      cookie if present → `resolvePostAuthRoute`. — GET Route Handler `app/auth/callback/route.ts` +
      `lib/clerk-server.ts` (`provisionOrResolveClerkUser`, race-safe) + `lib/auth-callback.ts`.
- [x] Middleware matcher — VERIFY against Clerk v6 docs first; broaden for `/__clerk/:path*` + the auth
      routes; **keep `/s/[token]` and `/a/[token]` excluded** (existing carve-out). — Clerk-canonical
      negative-lookahead (verified via context7) + `/s/`,`/a/` carve-out. NOTE: `/api/media` stays
      MATCHED on purpose — the authenticated hub resolves Clerk `auth()` there; only PAGE token
      surfaces are excluded (a reviewer suggestion to also carve out `/api/media` was rejected as it
      would break hub playback).
- [x] `/join/[token]` rework — anonymous branch sets httpOnly pending-invite cookie {token,
      relationshipLabel} → Clerk sign-up → `/auth/callback` accepts + clears cookie. Signed-in
      direct-accept path preserved. Relationship label stays collected up front. — `lib/pending-invite.ts`
      + `lib/join-actions.ts`; mock path unchanged.
- [x] Sign-out — custom Kindred control; Clerk-configured → client `useClerk().signOut({redirectUrl:'/'})`,
      else existing mock server action. No `<UserButton/>`. — `_kindred/ClerkSignOutItem.tsx` code-split
      via `next/dynamic` so Clerk never enters the mock bundle.
- [x] Clerk-mode seed — bind personas to real Clerk users by `getUserList({ emailAddress })`; store real
      `userId` as `authProviderUserId`; skip `mock_auth_users` insert; skip-with-warning if unmatched.
      Seed stays authoritative for persona `displayName`/`spokenName`. — personas use
      `+clerk_test@example.com` emails uniformly; degrades (skips family block) if a CORE persona is unmatched.
- [x] Regression: JIT provision idempotency + concurrent-landing race; `/auth/callback` pending-invite
      apply; route mode-switch (Clerk vs mock). — `clerk-server.test.ts`, `auth-callback.test.ts`,
      `pending-invite.test.ts`, `join-clerk.test.ts`, `dev-seed.test.ts` (Clerk-mode).

**Slice 2 — magic-link via Clerk sign-in tokens.**  ✅ *DONE — all automated gates green
(typecheck / `-r test` / web build) + architecture canaries unchanged; four cold adversarial review
passes closed (one per task + a holistic pass); LIVE acceptance PASSED on the dev Clerk instance
(2026-06-30, dev `sk_test_`/`pk_test_`).*
*Acceptance: mint a sign-in token → redeem → land authed on `/hub/answer/[askId]`.*
**GATE satisfied: prod Clerk keys (`sk_live_`/`pk_live_`) may now go live — still a deliberate,
separately-confirmed step, not automatic.**
*Live evidence (dev Clerk, Eleanor = `eleanor+clerk_test@example.com`, port 3100):* from a
logged-OUT browser, `/a/<eleanorToken>/<realAskId>` minted a Clerk sign-in token → `/auth/redeem`
redeemed it client-side (`signIn.create({strategy:'ticket'})` → `setActive`) → landed AUTHED on
`/hub/answer/<realAskId>` showing Sofia's seeded question (account menu confirmed identity = Eleanor;
Clerk loaded with dev keys on the redeem route). An invalid ticket at `/auth/redeem` warm-degraded to
`/s/<eleanorToken>` (verified twice). Clerk-mode seed bound all four `+clerk_test` personas live.
- [x] `/a/[token]/[askId]` (Clerk path) — mint `clerkClient().signInTokens.createSignInToken({ userId })`
      → redirect to redemption route. Mock path unchanged. — seam widened to a discriminated result
      (`{kind:"established"}` vs `{kind:"handoff";ticket}`, ADR-0003); Clerk adapter reverse-looks-up
      (`auth-clerk.ts resolveAuthProviderUserId`) + mints (`clerk-server.ts mintSignInToken`, injectable
      seam); route stays provider-agnostic via pure `lib/magic-link.ts resolveMagicLinkTarget`.
- [x] `/auth/redeem` — client route: `signIn.create({ strategy: 'ticket', ticket })` → `setActive` →
      hard-nav to dest. — server gate `page.tsx` (gates on `isClerkConfigured()`+ticket) → `next/dynamic`
      `RedeemClientLoader` → `RedeemClient` (the sole `useSignIn` importer, code-split out of the mock
      bundle); single-use-ticket ran-once guard; open-redirect-guarded dest (`safeInternalDest`).
- [x] Remove the throws-and-degrades branch for the Clerk adapter's `establishAccountSession` seam. —
      old "not supported in Phase 1" throw gone; route's expected-throw degrade branch replaced by a
      genuine try/catch that warm-degrades to `/s/[token]` only on a real mint/DB failure.
- [x] Regression (unit): seam handoff/established + reverse lookup + mint
      (`__tests__/magic-link-handoff.test.ts`); redirect/open-redirect helpers
      (`__tests__/magic-link-url.test.ts`, incl. percent-encoded `//` bypass). LIVE regression PASSED
      on dev Clerk (2026-06-30): ticket landed Eleanor on `/hub/answer/<realAskId>`; invalid ticket
      warm-degraded to `/s/<token>`.

## Increment — DIRECT STORY CREATION + text-origin stories (ADR-0007)  ✅
*DONE — all automated gates green (`pnpm -r typecheck` / `pnpm -r test` / oxlint clean for touched files);
subagent-driven build, each task closed by a fresh cold adversarial reviewer. Manual dev-server smoke of
the two capture flows is still OUTSTANDING (see note). Implements the Accepted ADR-0007.*
A person can now create a Story on their own initiative ("tell a story", no Ask), by voice OR typed text,
with an AI-generated-then-editable title — reusing the answer flow as one generalized composer.
- [x] Schema: `story_kind` enum (`voice|text`); `stories.kind NOT NULL DEFAULT 'voice'`; nullable
      `recording_media_id`; CHECK `stories_kind_recording_ck`; `user_authored` prose level. — `@chronicle/db`
- [x] Core: `createTextDraft` (text draft + `user_authored` L1, no media); `listOutstandingDrafts`
      (self-initiated + ask-backed) with `listOutstandingAnswerDrafts` preserved as latest-per-ask wrapper;
      `discardDraftStory` tolerates null recording. — `@chronicle/core` `story-repository.ts`
- [x] Capture: `ingestTextStory` (no storage write). — `@chronicle/capture`
- [x] Pipeline: `start()` routes text → `render_story` (skips `transcribe`); pipeline view media join
      → LEFT join so null-recording text stories resolve. — `@chronicle/pipeline`
- [x] Web: `composeStoryAction` (voice-or-text, ask-optional) + `shareAnswerAction` persists edited title;
      `AnswerFlow` → `StoryComposer` (voice⇄text toggle, editable title, answer+tell modes); `/hub/tell`
      (+ `/hub/tell/[storyId]` resume); Stories-tab "Tell a story" entry + self-draft resume list. — `apps/web`
- [x] AI-polish reuse: `polishAnswerProseAction` was already ask-optional; folds in via `KindredProseEditor`
      `onPolish` in the shared composer — no new task.
- Note (LOAD-BEARING, needs sign-off): draft discard for stories carrying prose revisions required relaxing
      the `prose_revisions` delete guard from blanket-immutable to **consent-scoped** (mirrors
      media/take guards; fixes a latent rendered-voice-draft discard bug). `consent_records` untouched;
      post-consent lineage still frozen. Dev/prod Neon branches need a **reseed** to pick up the new trigger.
      See ADR-0007 "Load-bearing amendment".
- Note: dev-server manual smoke (type-a-story → share; record-a-story → share) is unverified in this
      headless env (no browser/mic), consistent with Increment 2's capture-path note.

## Increment — THE COMPOSING SURFACE (ADR-0014, Inc 0–5)  ✅  *(2026-07-04)*
*DONE on this branch — all automated gates green (`pnpm -r typecheck` / `pnpm -r test` / web build);
subagent-driven, each slice closed by a fresh cold adversarial reviewer. NOT pushed / merged to master.*
Replaces the monolithic `transcribe → render` on-stop + `pending_approval` review editor with a live
composing surface: authored prose, per-take capture, the four passes, an explicit Finish, and a still-
separate Share. Implements the Accepted ADR-0014 (amends ADR-0007; builds on ADR-0012 & ADR-0004).
- [x] **Editor lives in `DRAFT`** (`ComposingEditor.tsx`): record OR type interleaved, hand-edit, opt-in
      ✨ Polish. The old `pending_approval` review editor + "Polishing your words" spinner are gone.
- [x] **Four passes, enum renamed**: Transcription `ai_transcribed` → per-take Cleanup `ai_cleaned`
      (auto, sees one take) → opt-in Polish `ai_polished` (manual, holistic) → Correction
      `human_corrected`; typed takes are `user_authored` and skip transcribe+cleanup. Every AI pass logged.
- [x] **Per-take Transcription + Cleanup run synchronously inline** in the capture action
      (`transcribeTakeToRecording` + `cleanupTake`, no durable Inngest hop per take); `appendVoiceTake/
      TypedTakeContribution` concatenate onto the CLIENT'S `priorProse` (non-clobbering). Any audio ⇒ `voice`-kind.
- [x] **Explicit Finish** (`finishDraftAction` → `deriveMetadata` + `human_corrected` snapshot +
      `assertStoryTransition` DRAFT → PENDING_APPROVAL) with a speculative **Finish-check** (accept = a
      logged Polish, 0 extra LLM calls). `PENDING_APPROVAL` shrinks to confirm-title + tier + **Share**.
- [x] **Consent still a separate tap** (ADR-0004): `shareAnswerAction` → `approveAndShareStory` appends one
      immutable `approved_for_sharing` ledger row. Finish ≠ Share.
- [x] **Intake unified onto the surface** (`/hub/about-you`) but stops at anchor extraction — not a Story;
      separate `intake_revisions` ledger (Inc-4); memory extraction consent-gated (Story post-approval, intake at Save).
- [x] **Observability** (Inc 5): server `plog`/`plogError` correlated per request via `beginLogContext`
      (AsyncLocalStorage cid; intake path correlated too) + client `clog` per capture-state transition.
      Toggles: `CHRONICLE_PIPELINE_LOG` / `CHRONICLE_PIPELINE_LOG_FULL`; `NEXT_PUBLIC_CHRONICLE_CLIENT_LOG`
      / `localStorage["chronicle:clog"]`.
- Note: docs trued up to the shipped flow (`docs/adr/0014-*` status → Implemented; `docs/adr/0007-*`
      §7 amendment; `docs/Recording-To-Story-Pipeline.md` full rewrite). Legacy monolithic orchestrator
      survives only for the link-session `/s/[token]` surface. Dev-server manual smoke still headless-blocked.

## Increment — FAMILY SCOPE SELECTOR (create/join any time, multi-family hub)  ✅  *(2026-07-05)*
*DONE on the `feat/family-scope-selector` branch — Increments 1–4 + the Invite-gate fix.*
Design: `docs/superpowers/specs/2026-07-05-family-scope-selector-design.md`;
plan: `docs/superpowers/plans/2026-07-05-family-scope-selector.md`.
Creating a family and requesting to join are now always-available in-app actions, and the hub is
multi-family aware.
- [x] Hub scope selector `[ All ▾ ]` (`apps/web/app/hub/HubScopeSelector.tsx`): All + active-family
      scope rows, muted pending-join rows, pinned `+ Create a family` / `Find a family to join`. Owns a
      single server-read `?scope=` param (default `all`, validated in `hub/page.tsx`, leak-safe fallback
      to `all`). Dead `manage-family` account-menu stub removed; per-tab controls (Stories `?scope=`,
      Album `?family=`) retired into this one param.
- [x] Routing: `resolvePostAuthRoute` Gate C DELETED — onboarded pending-only user → `/hub`
      (empty-state) instead of `/families/find`; zero-relationship → `/families/start`; not-onboarded
      → `/welcome`. `/hub` guard admits pending-only viewers.
- [x] Read tabs (Stories, Album, Asks) — deduped union in `All`, filter to one family when scoped.
      Ask compose family multi-select seeded from scope (≥1 family, server-guarded); Requests filters
      by scope + aggregates per-family in `All`; Invite single-family (`resolveInviteFamilyId`, explicit
      pick in `All` with >1, hidden/empty for members-of-none).
- [x] Data model: asks become N-family — `ask_families` M2M join replaces nullable `asks.familyId`;
      `createAsk(familyIds: string[])`; approval unions ask families into `story_families`; `eraseAsk`
      gathers stewards across all. Migration `0003_equal_master_mold.sql` (create → backfill → drop
      column) applies to Neon at deploy; snapshot regenerated (drift-guard green).
- ~~Deferral (not a bug): story-compose has NO family-target picker~~ — RESOLVED by the increment
      below (`feat/multi-family-picker`, 2026-07-05).

## Increment — STORY-SHARE MULTI-FAMILY PICKER  ✅  *(2026-07-05)*
*DONE on the `feat/multi-family-picker` branch.* Resolves the story-compose deferral from the
family-scope-selector increment above — the ADR-0010 story multi-target picker is now wired.
- [x] Web share/review step (self-authored tellings AND answers to asks) renders a multi-family
      picker for `family`/`branch` tiers via a shared `<FamilyPicker>` component (unifies the ask,
      album, and story-share pickers). Seeded from the answered ask's families (answers) or hub
      `?scope=` (tellings); resolved server-side by `resolveComposeFamilies` in `shareAnswerAction`.
      Single-family author → no picker (auto-resolved); ambiguous multi-family → explicit pick forced.
- [x] Core: `approveAndShareStory` takes an explicit `familyIds` param that, when non-empty,
      **replaces** `computeDefaultFamilyTargets`, re-validates against the owner's ACTIVE memberships,
      and writes `story_families` in the same transaction. New shared `replaceStoryFamilyTargetsTx`
      helper now backs both this and `setStoryFamilyTargets`.
- [x] Album/photo-upload picker also seeds its default from hub `?scope=`. Ask targeting
      (`ask_families`) unchanged.
- No leakage-suppression display gate built (investigated, found MOOT — no answer-story renders its
      originating question in any feed).

## STORY IMAGERY (photos) — 5-phase plan  📸  *(designed 2026-07-03; ADR-0009)*
Album, attach-to-story, story-from-a-photo, cheap suggestion, Google Picker import. Each phase is a
tracer-bullet vertical slice sized to the subagent-build + fresh-cold-reviewer loop; schema rides the
migration + reseed workflow; PGlite + core-allowlist + vendor-seam architecture tests each phase.

### Phase 1a — Family album: schema, upload, browse  ✅  *(no AI, no OAuth, no stories)*
- [x] Schema: `family_photos` (contributor, `source` enum, `storage_key`, `caption`, `exif_captured_at`,
      `exif_gps`, timestamps, soft-delete) + `family_photo_families` (M2M join). — `@chronicle/db`
- [x] Storage: `family-photos/**` keyspace via `@chronicle/storage` (R2), **write-once** bytes; photos
      are *not* `media`. — `@chronicle/storage` (web action writes keys; no capture package needed)
- [x] Core: audited **album-read seam** (`album-repository.ts` on the core allowlist); album-tier byte
      visibility via active-membership. — `@chronicle/core`
- [x] Web: file-input upload (also the Apple/device path; EXIF captured at import), family-scoped album
      grid (recency) via hub `?tab=album` + `/hub/album` + `/api/album-photo/[photoId]`. — `apps/web`
- *Slice value:* upload a photo → it lands in the family album → see the grid.

### Phase 1b — Album management: caption + delete  ✅
- [x] Core/web: caption edit (contributor/steward, last-write-wins, off-ledger); delete
      (contributor/steward) — soft-delete + bytes 404 thereafter (purge deferred). Cascade un-attach is
      realized at read time once Phase 2 `story_images` exist. — `@chronicle/core`/`apps/web`
- *Slice value:* caption and delete photos already in the album.

### Phase 2 — Attach photos to a story + card/gallery display  ✅  *(accompaniment)*
- [x] Schema: `story_images` (nullable `family_photo_id`, `provenance` enum + reserved inline
      illustration cols, `is_cover`, `position`, `attached_by`). — `@chronicle/db`
- [x] Core: extend image-read seam — an attached photo is visible to the **parent story's** audience
      (`decideAlbumPhotoRead` Arm 2 via `story-image-repository.ts`); links visible only when the
      parent item is. — `@chronicle/core`
- [x] Web: attach/detach/cover/reorder in pre-share review (`StoryPhotosEditor` on
      `pending_approval`, off consent ledger); Feed card shows cover, **no placeholder when empty**;
      opened story shows the gallery. Soft-delete photo → read-time un-attach. — `apps/web`
- *Slice value:* stories illustrated with family photos.

### Phase 3 — Story from a photo + Ask-targets-photo  ✅  *(subject)*
- [x] Schema: `stories.subject_photo_id` (nullable FK) + `ask_subject_photos` join. — `@chronicle/db`
- [x] Flow: "tell the story of this photo" → capture with `subject_photo_id` preset + auto first
      `story_images` row + interviewer opener seeded from the caption. Ask targets subject photo(s);
      answering yields a Story from that photo (hub + link-session `/api/capture` carry-forward). —
      `@chronicle/core`/`apps/web`
- *Slice value:* photos become story seeds, from self and relatives.

### Phase 4 — Suggestion + the photo nudge  ✅  *(cheap engine, editor-time)*
- [x] Rank a draft's candidate photos by **caption-text match ∪ EXIF-date proximity to `eraYear`**;
      silent picker ranking + the editor **nudge**. Deterministic/heuristic first; reserve a
      `PhotoUnderstanding` vendor-seam *interface* (mock only) for the future vision ranker. —
      `@chronicle/pipeline` (`rankPhotosForStory` / `pickPhotoNudge` + `ScriptedPhotoUnderstanding`);
      wired in `loadStoryPhotoEditorAction` + `StoryPhotosEditor` nudge banner; web Slice B §5
      covered by `story-photo-suggestion.server.test.ts`.
- *Slice value:* the right photo floats up without browsing.

### Phase 5 — Google Photos Picker import  ✅  *(connect-once OAuth — locked 2026-07-09)*
User's **own** Google Photos library via the **Picker API** (not Image Search / not silent Library
browse). Product choice: **connect once**, not re-consent every import.
- [x] OAuth connect: `photospicker.mediaitems.readonly` → store **encrypted refresh token** per Person
      (at-rest secret; never log). Access token minted on demand for each picker session.
- [x] Disconnect control (settings / album): revoke + delete stored refresh token.
- [x] Google Picker API adapter (isolated adapter file, vendor-seam rule): create picker session with
      fresh access token → user picks → copy selected bytes → `family_photos` with
      `source='google_picker'`. Picker UI every import; Google consent only on first connect (or after
      disconnect / token revoke).
- [x] Album UI: "Import from Google Photos" (connected vs connect CTA).
- Apple needs nothing (Phase 1 file input covers device photos). — `@chronicle/photos-google`
  adapter (+ thin web OAuth routes `/api/google-photos/connect|callback` + album actions).
- *Depends only on Phase 1 — can slot in right after it if the import surface is wanted early.*
- *Rejected alternative:* strict ephemeral / no refresh token (would re-prompt Google consent often).

### Deferred to their own design passes (parked in OPEN-QUESTIONS)
Vision photo-understanding (premium tier) · external open-license illustrations · photos-only /
combined photo+story feed · depicted-third-party consent.

## Seams to leave UNBUILT (Appendix) — verify each increment doesn't foreclose them
branch-level audience · time-gated release · telephony channel · external-record enrichment /
timeline-map-tree · steward console & succession · avatar consent gate & story-will ·
broader engagement-trigger catalog.
