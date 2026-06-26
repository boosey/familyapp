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
- [x] Session token → elder Person + Family context (no login, token IS identity) — `@chronicle/capture` sessions, hashed tokens, expiry/revoke
- [x] Thin elder web page: greeting, one start control, listening state, one stop — `apps/web` `/s/[token]`
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
      `listElderMemoryForInterviewer` (SQL-projection-only: title/summary/tags/promptQuestion/
      createdAt; no transcript/prose/storageKey ever selected). On `story-repository.ts` which
      is already in the architecture-test allowlist.
- [x] Voice interface (ElevenLabs default per DECISIONS) + `ScriptedVoice` mock

## Increment 5 — VOICE-ONLY APPROVAL GATE  ✅
- [x] Voice approval in-session; capture `approval_audio` Media — `captureApproval` in `@chronicle/capture` (storage-first ordering mirrors `ingestRecording`)
- [x] Atomic: Story pending_approval → approved → shared @ chosen tier + first ConsentRecord — `approveAndShareStory` (audited core write); one `db.transaction`, both state legs through `assertStoryTransition`, intermediate `approved` row persisted
- [x] Voice correction regenerates prose only; audio untouched — `applyTranscriptCorrection` (core) + `applyVoiceCorrection` (pipeline coordinator); recording pointer structurally unreachable from these seams
- [x] Authorization function refuses to surface Story without approved/shared + backing ledger row — regression covers full lifecycle (pending→shared@family→revoked)

## Increment 6 — BASIC FAMILY HUB  ✅
- [x] Logged-in younger-gen surface; approved-stories list (original voice primary, prose secondary) — `/hub` server component, audio rendered first with prose in `<details>` collapsed by default
- [x] Invite-link generator (creates session token) — `/hub/invite` via audited `createElderSession`; raw token handed to result page via short-lived httpOnly flash cookie (NEVER via URL query — would leak via logs/history/Referer)
- [x] Ask submission — `/hub/ask` via new `@chronicle/core` `createAsk` (co-membership gated; non-anonymous; non-empty; spoofed-familyId rejected)
- [x] All reads strictly through the authorization function — hub feed via `listStoriesForViewer`; `/api/media/[id]` via `getMediaForViewer` (404 indistinguishable from "no access")

## Increment 7 — ASKED-QUESTION RELAY (self-feeding loop)  ✅
- [x] Ask queued → routed into interviewer queue (one of several prompt sources = seam) — `createCoreAskSource` adapter calls `listPendingAsksForElder` + `markAskRouted`; turn loop calls `askSource.markRouted` after `ask` intent
- [x] Prioritize + frame warmly with asker named; buffered, never interrupts elder — already in `behavior.ts`/`phraser.ts` from I4; `/api/capture` accepts optional `askId` to bind a recording to an Ask
- [x] On approval: Ask → answered + Story pointer; deliver answer back to asker (hub notification) — `approveAndShareStory` atomically flips a linked Ask to `answered` (status + storyId + answeredAt) in the SAME tx as the consent ledger entry; `/hub/asks` shows the asker their submitted Asks with status + `getStoryForViewer`-gated link to the answered Story

## Seams to leave UNBUILT (Appendix) — verify each increment doesn't foreclose them
branch-level audience · time-gated release · telephony channel · external-record enrichment /
timeline-map-tree · steward console & succession · avatar consent gate & story-will ·
broader engagement-trigger catalog.
