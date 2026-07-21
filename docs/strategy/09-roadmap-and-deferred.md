# Roadmap and Deferred Work

*What's done, what's next, and what's intentionally parked. Living doc — update when priorities shift.*

**Related:** [Prioritized backlog](./prioritized-backlog.md) (build order + parking-lot triggers, ADR-0022) · [CONTEXT.md](../../CONTEXT.md) (vocabulary) · ADRs for accepted decisions.

---

## Shipped (Phase 0 + Phase 1 core)

| Milestone | Status |
|-----------|--------|
| Repo + monorepo spine | ✅ |
| Schema, auth oracle, consent ledger | ✅ |
| Link-session capture (`/s/[token]`) | ✅ |
| Pipeline (transcribe → prose) | ✅ |
| Interviewer behavior + follow-ups | ✅ |
| Approval gate | ✅ |
| Family hub (stories, questions, invite) | ✅ |
| Ask relay loop | ✅ |
| In-hub answer + composing surface | ✅ |
| Clerk auth (prod live) | ✅ |
| Provider-agnostic identity | ✅ |
| Direct story creation + text origin | ✅ |
| Story imagery (album, attachments, Google Picker) | ✅ |
| Multi-family scope + targeting | ✅ |
| Kinship tree + governance | ✅ |
| Mobile-responsive hub (ADR-0024/0025) | ✅ |
| App branding (Tell Me Again, logo) | ✅ |
| Chronicle search (keyword / full-text) | ✅ |
| Notification delivery (invites) | ✅ capability |
| Loop-event pings (email) | ✅ shipped (#270); SMS/prefs deferred (#271/#272) |

**Front of the build queue (2026-07-21):** album & upload hardening — see Prioritized Backlog #9.

---

## Near-term product gaps

| Gap | Notes |
|-----|-------|
| **Album & upload hardening** | Residual perf (#218/#219); front of prioritized backlog #9 |
| **Engagement digests** | Weekly "this week in family history" — needs delivery + content assembly |
| **Face tagging** | UI stub; no ML backend |
| **Public tier read surface** | Tier stored; no external sharing URL |
| **Branch-tier enforcement** | Value preserved; behaves as `family` |
| **Clerk social sign-in** | Off in prod until own Google OAuth client |
| **Album residual perf** | #218 / #219 |

---

## Parked features worth keeping (design notes)

These were captured in `OPEN-QUESTIONS.md` as needing their own design sessions. They are **not rejected** — they wait for corpus depth, consent work, or a prioritization re-run. Detail preserved here so they are not forgotten when that file is archived.

### Ask the archive (Mode 4 Q&A) — high value when the chronicle is rich enough

**What it is.** A read-only natural-language question answered from the family's chronicle. Distinct from an **Ask** (which goes to a living narrator): archive Q&A targets the corpus, creates no Story, waits for no human, writes no consent event.

**Why it waits.** Keyword/full-text **search** already ships. The Q&A synthesis engine (retrieval + LLM) needs:

1. **Enough content** — answers are only valuable once a family has a dense archive
2. **Grounding = visible projection** — the corpus MUST be exactly what that explorer may already see via the single front door, or a synthesized answer becomes a **consent leak** (quoting a private or unshared story)
3. **No-fabrication guarantees** — citations / "I don't know" / refuse to invent
4. **Escalation loop** — when the archive has no answer, offer to send a real **Ask** to the relevant narrator

**Design pass owns:** embeddings / retrieval seam, grounding-set authorization, citation policy, empty→Ask escalation UX. Same weight class as imagery-suggestion engines. Vocabulary: `CONTEXT.md` § Explore → *Ask the archive*.

### Asker-avatar (voice shipped-as-design; video deferred)

- **Voice asker-avatar** — asker's real recording delivered to the teller in-session (basic path). Consent scope for family-wide visibility, retraction (esp. minors at majority), and dual ownership (asker owns clip / narrator owns answer) wait for a dedicated consent pass. Seam: `deliveredToTeller` + nullable consent pointer on the Ask recording.
- **Video forms** (when designed, pick deliberately — do not default):
  1. Actual video of the asker
  2. Synthesized avatar lip-syncing asker's audio
  3. Synthesized avatar speaking typed question (TTS)
  4. Synthesized avatar speaking an AI rephrase of the question  
  Forms 2–4 are governance-heavy; form 4 is the same "no silent rewrite" deferral as voice. Belongs at/after consent/estate work.
- **Safety** — an asker's clip is unmoderated human content in the narrator's dignified space. Options later: trust the closed family; narrator/steward pre-screen; sensitivity-gate the transcript before play.

### Richer biographical "picture of the person"

Beyond the fixed six-field anchors (`hometown`, `siblingContext`, `currentLocation`, `occupationSummary`, `hasChildren`, `hasGrandchildren`): extract an evolving portrait from approved stories — not a fixed schema. Own brainstorming / design session. Consent-gated (post-approval only), same discipline as current memory extraction.

### Depicted-third-party consent for photos

Uploading a photo is the uploader's consent for family reuse (ADR-0009). Deferred: a *depicted* third party may suppress photos they appear in — with face recognition, system-wide; without it, a request to the uploader. More control than public social networks; private-network context. No `consent_records` for images today (mutable presentation).

### LLM-suggested family targeting

On create (Story, later Ask/caption): LLM suggests which of the owner's families the item belongs to (e.g. wedding → both lines). Suggestion only — narrator confirms. Never auto-apply (never over-share by default). Same class as imagery suggestion / era inference.

### Map surface (Explore)

Timeline / feed / search are projections over existing fields. A **map** is not: places are free text (`eraLabel` / place labels) without coordinates or a Place entity. Needs geocoding design and a call: first-class reusable **Place** vs lat/lng stamped per story.

### Vision photo-understanding & external illustrations

Caption + EXIF ranking ships; vision-model ranking (`PhotoUnderstanding` seam) deferred — likely premium. External open-license illustrations: `provenance` seam exists; no provider/UI until a legal/license pass. Photos-only or combined photo+story feed also deferred (v1 feed is Stories).

### DSP / telephony persistence (engineering debt)

- Working-copy DSP still a typed passthrough (`speedFactor: 1.0`); real VAD / time-stretch adapter later
- `CaptureSource` (`web_link` | `telephony`) is type-shaped but not persisted on Media/Story — needed when telephony lands
- Periodic GC for orphan `story-audio/**` blobs after storage-first partial failures
- Confirm DPA before sending real narrator audio to transcription vendors (human/legal action)

### Assumptions still in force

- **`branch` audience tier** enforced as `family` until branch structure is modeled (value stored faithfully)
- Link-session token default expiry ~30 days, configurable
- Anonymous link-session can read own in-progress drafts; family cannot until approved+shared

---

## Medium-term (strategy-aligned, not tightly scheduled)

| Initiative | Dependency / note |
|------------|-------------------|
| Telephony adapter | Twilio seam; same pipeline; persist `CaptureSource` |
| GEDCOM / FamilySearch import | Background job + reconciliation UI |
| External record enrichment | Census, newspapers — original Phase 3 moat |
| Time-gated story release | Ledger + tier extension |
| Story-will / succession | Steward handoff product |
| Posthumous avatar (retrieval-only) | Consent framework gate; never generative grief-bot |
| Native iOS/Android app | Responsive web first (ADR-0024) |
| Periodic engagement engine | Digests + triggers catalog |
| Remaining kinship / tree depth | Parking lot; after ~3 families validate the loop |

---

## Explicitly out / ethics-parked

| Item | Rationale |
|------|-----------|
| Generative grief bots | Ethical line; retrieval-only for any avatar |
| DNA / genetic module | Surprise kin, law-enforcement exposure, breach precedent |
| Family coordination / logistics | Not a chronicle product |
| Anonymous public chronicle | `public` tier is a seam, not a launch surface |
| Background Google Photos sync | Picker-only per Google API policy 2025 |
| Apple Photos web API | No API; native app only |

---

## How to prioritize (ADR-0022)

Method: gated two-layer prioritization. **Live sequenced queue + parking lot:** [`prioritized-backlog.md`](./prioritized-backlog.md). Re-run when stage changes, a parking-lot trigger fires, new candidates arrive, or shipped state moves.

---

## Documentation maintenance

| When | Update |
|------|--------|
| New user-facing feature ships | `04-what-is-built.md`, `05-user-journeys.md` |
| New ADR accepted | `07-architecture.md` index + relevant strategy doc |
| Positioning change | `01-product-overview.md`, `02-vision-and-mission.md` |
| Terminology change | `CONTEXT.md` first, then `06-domain-and-data-model.md` |
| Prioritization pass | Prioritized backlog (not this file alone) |
