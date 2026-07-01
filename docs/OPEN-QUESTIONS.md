# OPEN QUESTIONS & ASSUMPTIONS

Things resolved with an assumption (so Alex can correct later) and things stubbed because they
would require real-world action (paid accounts, vendor signup, real personal data, cost).

## Stubbed — would require your real-world action (spec "stop and ask" case 2)

- ~~**All paid vendor adapters are stubbed/mocked.**~~ **Resolved 2026-06-27.** Real
  adapters now exist for all six vendors: Groq (`@chronicle/transcribe-groq`), Anthropic
  (`@chronicle/llm-anthropic`), ElevenLabs (`@chronicle/voice-elevenlabs`), Clerk
  (`apps/web/lib/auth-clerk.ts`), Cloudflare R2 (`@chronicle/storage`'s `R2MediaStorage`,
  real `@aws-sdk/client-s3` impl), Inngest (`@chronicle/queue-inngest`), plus Supabase
  Postgres (`createPostgresDatabase` in `@chronicle/db`). Each adapter is fully tested
  against fakes/HTTP mocks. **API keys + accounts are still required to actually invoke
  these against the real services** — the adapters are wired but neither CI nor the dev
  loop exercises them end-to-end against production vendors. No real narrator audio has been
  sent anywhere. See `docs/DECISIONS.md` "Vendor adapters (Phase 1 finish)" for per-
  adapter design notes.
- **Data-processing agreements.** Spec requires confirming a DPA before sending real narrator
  audio to any transcription vendor. Not actionable by me; flagged for you.

## Parked features — need their own design session

- **Asker-avatar: video forms (2026-07-01).** Phase 2 ships the *voice* asker-avatar only (the
  asker's real audio recording delivered to the teller in-session). Video is deferred, and when it
  lands it may take any of four forms — noted now so it's designed deliberately, not defaulted:
  1. an **actual video recording** of the asker;
  2. a **synthesized avatar** lip-syncing the asker's **audio recording**;
  3. a **synthesized avatar** speaking a **typed** question (TTS);
  4. a **synthesized avatar** speaking an **AI rephrasing** of a recorded or typed question.
  Forms 2–4 are governance-heavy (synthetic likeness + minor PII) and belong at/after the Phase-4
  consent/estate layer. Full-AI-rephrase of the question (form 4, and its audio equivalent) is the
  same "no rewrite yet" deferral already taken for the voice ask.
- **Asker-avatar: consent scope (2026-07-01).** Deferred by decision. Basic functionality first:
  the recording is a permanent Media linked to the Ask and travels **asker → teller only**. The
  data model must reserve the seam now (a `deliveredToTeller` flag + a nullable consent pointer on
  the Ask recording) so consent is a fill-in, not a retrofit. Family-wide visibility of the clip,
  retraction (esp. a minor retracting at majority), and the dual-ownership of a Q&A artifact
  (asker owns the clip, narrator owns the answer) all wait for the big consent discussion.
- **Asker-avatar: safety/moderation of the asker's clip (2026-07-01).** Unflagged risk to surface
  later: an asker's recording is *unmoderated human content* played into the narrator's dignified,
  "sacrosanct" space. A distressing or inappropriate clip could reach a vulnerable elder. Options
  to weigh when designed: trust the closed family group; let the narrator/steward pre-screen;
  transcribe the clip and run the existing `behavior.ts` sensitivity gate over the transcript
  before it may play in-session. Not built now; noted so shipping the clip path is a conscious
  choice, not an oversight.

- **Richer biographical "picture of the person" extraction (2026-06-29).** Beyond the current
  fixed 6-field `augmentProfileFromStory` (hometown, siblingContext, currentLocation,
  occupationSummary, hasChildren, hasGrandchildren), Alex wants to extract key facts about a
  person by analyzing the stories they submit — building an evolving portrait, not a fixed schema.
  Flagged as a new feature deserving its own brainstorming/design session; not in the prose-
  provenance work (see `docs/superpowers/specs/2026-06-29-prose-provenance-and-human-correction-design.md`).

- **Depicted-third-party consent for story imagery (2026-07-01).** A family photo can show people
  other than the uploader. Alex's intended (deferred) model: uploading a photo IS the uploader's
  consent, and no further consent is needed to reuse that photo anywhere in the system. A *depicted*
  third party's control is a later feature — **with facial recognition**, a recognized person may
  suppress a photo they appear in system-wide; **without it**, a withdrawal is only a *request to the
  uploader* to suppress. This is deliberately more third-party control than public social media offers
  (and arguably overkill given this is a private, non-public network) — recorded as intent, not built
  in v1. No `consent_records` involvement for images; images are mutable presentation (see CONTEXT.md
  "Story imagery").

- **Story imagery: suggestion/search, external source, and photo-library integration (2026-07-01).**
  The album + attachment model is designed (ADR-0009), but three sizable sub-features were
  deliberately *not* grilled and should not ship as one increment: (1) the **suggestion/search**
  mechanism (a content→image vendor seam, how story tags/prose feed it, family-album search vs.
  external, ranking, the pipeline stage); (2) the **external open-license source** (which provider,
  license/attribution capture, legal); (3) **Apple/Google Photos** integration (OAuth-heavy — likely
  its own phase). Each needs its own design pass.

## Assumptions made (correct me if wrong)

- **"Branch" audience tier == "family" for enforcement** until branch structure is modeled
  (spec permits this explicitly; the stored tier value is kept faithfully and is non-lossy).
- **Session token expiry default: 30 days, configurable.** Spec says "optionally time-bounded";
  picked a generous default so a narrator's link doesn't die mid-relationship. Tokens are long,
  unguessable (256-bit), stored hashed.
- **Time-stretch default factor 1.6x, backing off to 1.3–1.4x on low-SNR audio**, hard cap 2x,
  per spec guidance. SNR/“hard audio” detection is a stub heuristic in Phase 1 (configurable).
- **`@chronicle/pipeline` working-copy DSP is stubbed (Increment 3).** The `WorkingCopyTransformer`
  contract is the right shape (single-segment to multi-segment, `speedFactor`, hard-audio backoff
  hook), but the default impl does NOT actually run VAD trim or time-stretch on the bytes — it
  is a typed passthrough that REPORTS `speedFactor: 1.0` so persisted word timings stay honest
  in the absence of real DSP. A real adapter (ffmpeg-wasm in-process, or a thin Python sidecar)
  is the obvious follow-up; the interface earns its keep then. Until that lands, transcription
  cost/latency wins from the spec do not apply; correctness does. (See `working-copy.ts` docstring.)
- **VAD segment stitching past the per-request floor (e.g. Groq's 10s minimum) is not yet
  implemented** — the orchestrator currently sends the single working-copy segment the stub
  reports. The segment-table seam in `WorkingCopyResult.segments[]` is shaped so a real adapter
  can return many segments and the orchestrator's 1x-mapping math already handles them, but the
  stitching policy itself (which segments to join into one transcribe call) lives in the future
  adapter, not in the orchestrator.
- **Anonymous link-session reads:** the authorization function accepts "no Person" (token-scoped
  capture surface). The narrator can always access their *own* in-progress story via the session
  token even while it is `private`/`draft`; family members cannot until approved+shared.
- **Capture source channel is type-shaped but not yet data-shaped.** `ingestRecording` accepts a
  `CaptureSource` ("web_link" | "telephony"), but Phase 1 does not persist that value on the Media
  or Story row — a future telephony adapter producing the same `CapturedAudio` would be
  indistinguishable downstream from a web-link capture. The seam is correct at the function
  signature; persistence will land in Increment 3 when the JobQueue routes pipelines by source
  (telephony will likely want different VAD / transcriber tuning). Closing this earlier requires
  a schema migration; left for I3 where it earns its keep.
- **Orphan storage objects from partial capture failures (storage-first ordering).** A periodic
  GC pass for `story-audio/**` blobs that have no corresponding `media.storage_key` row is a
  Phase-2 housekeeping job. Phase 1 favors audio preservation; see DECISIONS for the trade-off.
- **PGlite for prod-parity testing only.** Production is managed Postgres (Supabase). If you
  prefer Prisma, the schema is small enough to port; noted in DECISIONS why Drizzle was chosen.
