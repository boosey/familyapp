# Decided/designed but NOT implemented — snapshot 2026-07-04 (post-ship revision)

Supersedes the earlier 2026-07-04 draft of this file (which described master *before* the
July-4 merge burst and mislabeled ADR-0014, ADR-0008 erasure, and DB migrations as unbuilt).
Reconciled against master at HEAD `122a97d` — i.e. **after** the composing-surface branch merged
to master and the whole stack shipped to production. Three of the scariest items in the prior
draft are now BUILT and LIVE; what remains is smaller and more honest.

**What flipped since the pre-merge draft:**
- ADR-0014 four-passes composing surface — was "0% reachable on master"; now **shipped, reachable,
  in production** (Inc 0–5).
- ADR-0008 story/ask/caption erasure — was "half built"; now **built** (`eraseStory` / `eraseAsk`
  / `eraseVoiceCaption` + erasure audit + migration `0001`).
- DB migrations — was "designed, not implemented"; now **implemented** (drizzle-kit chain
  `0000`/`0001`/`0002` applied to Neon at deploy).

## Tier 1 — Genuinely not built / not reachable (the ones that still matter)

1. **Story Imagery — only Phase 5 remains.**
   - ✅ Phase 2 (attach photos, `story_images`, card/gallery) — built (443714d).
   - ✅ Phase 3 (story-from-a-photo + `stories.subject_photo_id`, ask-targets-photo) — built (c37de39).
   - ✅ Phase 4 (suggestion ranker + editor nudge) — built (646e76a).
   - ❌ Phase 5 (Google Picker import): no adapter package; only the `google_picker` value is
     reserved in the `photo_source` enum (`schema.ts:923`). Import path unbuilt.

2. **Search is still a client-side `.includes()` filter.** No server-side full-text/tsvector
   (verified: no `to_tsquery`/`tsvector` in `story-repository.ts` or `schema.ts`). Browse narrows
   client-side after `listStoriesForViewer` — `StoryBrowse.tsx:355` filters in-memory
   (`items.filter((it) => matchesQuery(it, trimmed))`), and the file comment states outright
   "filtering only narrows what is displayed." Transcript is deliberately excluded from searchable
   text. ADR-0011's DB-pagination motivation remains unrealized.

## Tier 1b — ADR-0014 shipped, but with recorded residue (not illusions — known carve-outs)

ADR-0014 is **Implemented (Inc 0–5)** and live on master + in production. The hub composing
surface (`/hub/tell` and `/hub/answer/[askId]` → `StoryComposer` → `ComposingEditor`) is reachable
by real users with no feature flag gating it; the five core write functions
(`appendVoiceTakeContribution`, `appendTypedTakeContribution`, `finishDraft`, `logPolish`,
`logIntakePolish`) all have real server-action callers; Polish now **logs** an `ai_polished`
revision (story path `actions.ts:827`, intake path `about-you/actions.ts:215`); and the hub path
no longer auto-renders on stop — it appends per-take and derives metadata at Finish.

What still hasn't landed (each is deliberate, recorded in the ADR — listed so they aren't mistaken
for "done"):
- **Interviewer follow-up *proposal* is behind `FOLLOW_UPS_ENABLED` (default OFF)** — only whether
  a follow-up is *offered* after a take (`actions.ts:352`); append/Finish/Polish/typed-interleave
  all run regardless.
- **The legacy link-session `/s/[token]` capture surface is NOT converted.** It still runs the
  monolithic orchestrator — auto-renders on recording stop (`api/capture/route.ts:90` →
  `dispatchPipeline`), and its "Polish with AI" endpoint (`api/capture/polish/route.ts`) is still
  **stateless** ("persists nothing"; the L3 correction only lands on spoken approval). The
  four-passes model applies to the hub, not this token surface.
- **The narrator-memory "picture of the person" model is deferred** — only the consent-gated seam
  exists (a no-op `narratorMemory.record` sink, `actions.ts:765`). The evolving-portrait model is
  unbuilt.
- ~~`stitchAndRenderStory` is orphaned code~~ — **deleted 2026-07-04.** The function, its
  `index.ts` export, and its now-unused imports were removed; the pipeline test was pared to cover
  only the still-live `transcribeTakeToRecording` (renamed `per-take-transcribe.test.ts`). The
  "append, never re-render" behavior remains realized in the live path.

## Tier 2 — Code-complete but NOT live/verified

3. **Increment 9 Clerk auth — written, gated OFF (unchanged).** Middleware activates Clerk only
   when env keys are set; unset/placeholder keys → no-op passthrough so the DevCookie path keeps
   working (`apps/web/middleware.ts`). Slice 2 (magic-link) was live-verified on dev. Blocking
   go-live (all human/manual): Clerk dashboard set Name→required + seed-persona test users; run +
   record the Slice 1 live acceptance walkthrough; prod keys (`sk_live_`/`pk_live_`) deliberately
   off (separate go/no-go).

## Tier 3 — Wired but fake (infra stubs that silently no-op — unchanged)

- **DSP is a passthrough.** The default `WorkingCopyTransformer` (`working-copy.ts`) runs no VAD
  and no time-stretch — copies bytes, honestly reports `speedFactor: 1.0` (the docstring is
  explicit: reporting 1.0 keeps word timings honest since nothing was sped up). Spec's
  transcription cost/latency wins do not apply until a real ffmpeg/sidecar adapter lands.
- **VAD segment stitching:** not implemented (sends one whole-audio segment).
- **Telephony `CaptureSource`:** type-only — never persisted to any Media/Story row.
- **Orphan-blob GC for `story-audio/**`:** no sweep job exists.
- **No vendor exercised end-to-end except Clerk magic-link.** Groq/Anthropic/ElevenLabs/R2/Inngest
  are real adapters behind key-present switches, tested only against mocks. No real narrator audio
  has been sent anywhere. DPA sign-off (required before real audio → transcription vendor) is a
  human action, not code.
- **Richer biographical extraction:** both extractors hard-locked to the fixed 6-field profile;
  the "evolving portrait" idea is unbuilt (same seam as the narrator-memory deferral in Tier 1b).

## Tier 4 — Deliberately deferred (own design pass each — on the books, not surprises)

Asker-avatar video forms · asker-clip consent scope & moderation · depicted-third-party image
consent · LLM-suggested family targeting · Mode-4 "Ask the archive" Q&A · Mode-4 map surface ·
Mode-4 family-tree (no kinship model exists at all) · vision photo-understanding · external
open-license illustrations · photos-only/combined feed · prompt registry (contract/wording split)
· steward console & succession · telephony channel · time-gated release · branch-level audience
(currently == family) · broader engagement-trigger catalog.

---

## Now BUILT since the pre-merge draft (moved off the list — recorded so the reconciliation is auditable)

- **ADR-0014 composing surface / four passes** — Implemented Inc 0–5, live on master + production.
  See Tier 1b for the recorded residue.
- **ADR-0006 "ask a pending invitee / provisional Person"** — built (905cf13). `createInvitation`
  provisions a provisional Person; asks work against the invitation floor.
- **ADR-0008 story erasure / steward-delete-any** — built. `eraseStory` (owner + steward
  hard-delete), `eraseAsk`, `eraseVoiceCaption` in `packages/core/src/erasure-repository.ts`
  (exported from core index), backed by the existence-scoped media guard, the
  `chronicle.cascade_delete_story` consent-ledger token, `voice_captions` + `erasure_audit`
  tables, and migration `0001`. "Everything is deletable" is now true for Stories, not just photos
  and captions.
- **DB migrations** — implemented. The tree is no longer single-schema/blow-away: a drizzle-kit
  migration chain exists (`packages/db/drizzle/migrations/0000_baseline.sql`,
  `0001_soft_giant_girl.sql`, `0002_sudden_rhino.sql` + `meta/`), applied incrementally to Neon by
  `db:migrate` in the Vercel build, bonded to the snapshot by the drift-guard test. Migrations
  `0001` (erasure) and `0002` (intake_revisions) were applied to prod Neon at the 2026-07-04
  deploy. (`docs/superpowers/specs/2026-07-04-db-migrations-design.md` is now marked Implemented.)

Related handoffs/specs:
- `docs/superpowers/plans/2026-07-03-adr0014-inc3-blueprint.md` — Inc 3 build sequence (shipped)
- `docs/superpowers/plans/2026-07-03-adr0014-shared-contract.md` — frozen Inc 1–4 contract (shipped)
- `docs/superpowers/plans/2026-07-04-story-imagery-phase4-contract.md` — Phase 4 (built)
- `docs/superpowers/plans/2026-07-03-story-imagery-phase3-contract.md` — Phase 3 (built)
- `docs/superpowers/specs/2026-07-04-db-migrations-design.md` — migration design (implemented)
