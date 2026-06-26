# OPEN QUESTIONS & ASSUMPTIONS

Things resolved with an assumption (so Alex can correct later) and things stubbed because they
would require real-world action (paid accounts, vendor signup, real personal data, cost).

## Stubbed — would require your real-world action (spec "stop and ask" case 2)

- **All paid vendor adapters are stubbed/mocked.** Groq (transcription), Anthropic (LLM),
  ElevenLabs (TTS), Clerk (auth), Cloudflare R2 (storage), Inngest (queue) require accounts,
  API keys, and incur cost. Each sits behind an interface with a working mock/local impl; the
  real adapter is a thin shell that reads creds from env and is **not exercised** until you
  provision. No real elder audio is ever sent anywhere in this build.
- **Data-processing agreements.** Spec requires confirming a DPA before sending real elder
  audio to any transcription vendor. Not actionable by me; flagged for you.

## Assumptions made (correct me if wrong)

- **"Branch" audience tier == "family" for enforcement** until branch structure is modeled
  (spec permits this explicitly; the stored tier value is kept faithfully and is non-lossy).
- **Session token expiry default: 30 days, configurable.** Spec says "optionally time-bounded";
  picked a generous default so an elder's link doesn't die mid-relationship. Tokens are long,
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
- **Anonymous elder reads:** the authorization function accepts "no Person" (token-scoped
  elder surface). The elder can always access their *own* in-progress story via the session
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
