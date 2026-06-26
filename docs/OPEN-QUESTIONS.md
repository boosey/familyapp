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

- **Repo lives on Google Drive (`G:\My Drive\...`).** `node_modules` on a synced cloud drive
  causes sync churn + cross-volume copy slowness (pnpm can't hardlink C:→G:). Recommend either
  excluding `node_modules`/`.next`/`dist` from Drive sync, or moving the repo to a local path.
  Proceeding in-place with a thorough `.gitignore`.
- **"Branch" audience tier == "family" for enforcement** until branch structure is modeled
  (spec permits this explicitly; the stored tier value is kept faithfully and is non-lossy).
- **Session token expiry default: 30 days, configurable.** Spec says "optionally time-bounded";
  picked a generous default so an elder's link doesn't die mid-relationship. Tokens are long,
  unguessable (256-bit), stored hashed.
- **Time-stretch default factor 1.6x, backing off to 1.3–1.4x on low-SNR audio**, hard cap 2x,
  per spec guidance. SNR/“hard audio” detection is a stub heuristic in Phase 1 (configurable).
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
