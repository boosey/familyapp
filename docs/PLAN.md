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

## Increment 2 — CAPTURE PATH (web link, end to end)
- [ ] Session token → elder Person + Family context (no login, token IS identity)
- [ ] Thin elder web page: greeting, one start control, listening state, one stop
- [ ] In-browser audio capture (wideband); source-agnostic capture adapter (telephony seam)
- [ ] Immediate immutable persistence of `story_audio` Media (before any processing)
- [ ] Draft Story created pointing at the canonical Recording

## Increment 3 — PIPELINE (transcribe → speech-to-story)
- [ ] Durable, staged, idempotent flow behind JobQueue interface (in-proc impl + Inngest seam)
- [ ] Working-copy transforms: VAD trim + ~1.6x time-stretch; timestamps × speed factor;
      stitch segments past per-request minimum; **canonical audio never mutated**
- [ ] Transcriber interface (Groq Whisper Turbo default) + mock
- [ ] LanguageModel interface (Claude default) + mock; speech-to-story = faithful light render
- [ ] Story → pending_approval, still private; prose/transcript derived + regenerable

## Increment 4 — INTERVIEWER BEHAVIOR (the IP)
- [ ] Controlled turn loop wrapping the LLM (NOT an open chat)
- [ ] Behavior policy in our code: open/concrete/non-leading, one-at-a-time, silence-tolerant,
      reflect/follow, gentle sequencing, reminiscence-bump weighting, spoken off-ramp
- [ ] Four turn inputs: base question bank, pending Asks (prioritized, asker named),
      session memory, biographical anchors
- [ ] Cross-session memory + warm callback
- [ ] Voice interface (ElevenLabs default) + mock

## Increment 5 — VOICE-ONLY APPROVAL GATE
- [ ] Voice approval in-session; capture `approval_audio` Media
- [ ] Atomic: Story pending_approval → approved → shared @ chosen tier + first ConsentRecord
- [ ] Voice correction regenerates prose only; audio untouched
- [ ] Authorization function refuses to surface Story without approved/shared + backing ledger row

## Increment 6 — BASIC FAMILY HUB
- [ ] Logged-in younger-gen surface; approved-stories list (original voice primary, prose secondary)
- [ ] Invite-link generator (creates session token)
- [ ] Ask submission
- [ ] All reads strictly through the authorization function

## Increment 7 — ASKED-QUESTION RELAY (self-feeding loop)
- [ ] Ask queued → routed into interviewer queue (one of several prompt sources = seam)
- [ ] Prioritize + frame warmly with asker named; buffered, never interrupts elder
- [ ] On approval: Ask → answered + Story pointer; deliver answer back to asker (hub notification)

## Seams to leave UNBUILT (Appendix) — verify each increment doesn't foreclose them
branch-level audience · time-gated release · telephony channel · external-record enrichment /
timeline-map-tree · steward console & succession · avatar consent gate & story-will ·
broader engagement-trigger catalog.
