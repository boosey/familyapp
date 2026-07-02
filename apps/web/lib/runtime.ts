/**
 * DEV runtime wiring (local `next dev` only).
 *
 * Builds a persistent PGlite database and a filesystem media store, applying the schema once.
 * In PRODUCTION this module is the single place to swap in managed Postgres (Supabase/Neon via a
 * node-postgres Drizzle adapter) and Cloudflare R2 (R2MediaStorage) — nothing else in the app
 * changes, because everything depends on the @chronicle/* interfaces, not these concretions.
 */
import "server-only";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applySchema,
  applySchemaToPostgres,
  createPgliteDatabase,
  createPostgresDatabase,
  type Database,
} from "@chronicle/db";
import {
  FilesystemMediaStorage,
  R2MediaStorage,
  type MediaStorage,
} from "@chronicle/storage";
import {
  createPipeline,
  ScriptedTranscriber,
  ScriptedLanguageModel,
  withTranscriberLogging,
  withLanguageModelLogging,
  type Pipeline,
  type LanguageModel,
  type Transcriber,
} from "@chronicle/pipeline";
import { createGroqTranscriber } from "@chronicle/transcribe-groq";
import { createGroqLanguageModel } from "@chronicle/llm-groq";
import { createAnthropicLanguageModel } from "@chronicle/llm-anthropic";
import { Inngest } from "inngest";
import { createInngestJobQueue } from "@chronicle/queue-inngest";
import type { InngestFunction } from "inngest";
import { type AuthProvider } from "./auth";
import { createClerkAuthProvider } from "./auth-clerk";
import { createMockAuthProvider } from "./auth-mock";
import { isClerkConfigured } from "./clerk-config";
import { isInngestConfigured, assertInngestServeable } from "./inngest-config";
import { makeDispatchPipeline, type DispatchPipeline } from "./dispatch-pipeline";

export { isClerkConfigured, isInngestConfigured };

/** Stable app id for the Inngest client — also the dashboard app name. */
const INNGEST_APP_ID = "family-chronicle";

// Anchor relative paths to the apps/web package dir, not process.cwd(). On Windows Next dev's
// recursive `mkdirSync` against a relative path occasionally ENOENTs even when the directory
// already exists, depending on which cwd Next chose. Absolute paths sidestep the class of issue.
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function anchor(p: string): string {
  return isAbsolute(p) ? p : resolve(PKG_DIR, p);
}

const DEV_DB_DIR = anchor(process.env.CHRONICLE_DB_DIR ?? "./.pglite/dev");
const DEV_MEDIA_DIR = anchor(process.env.CHRONICLE_MEDIA_DIR ?? "./.media");

// Required R2 (S3-compatible) env vars. R2MediaStorage is selected only when ALL FOUR are present
// and non-empty: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
// (R2_PRESIGN_EXPIRY_SECONDS is intentionally NOT read — see selectMediaStorage below: this app
// never calls getUrl, so presign expiry is moot.)
type StorageEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

const R2_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
] as const;

/** A value "counts" as present only if it is a non-blank string (whitespace-only is NOT set). */
function present(v: string | undefined): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * PURE env→MediaStorage decision, extracted from `build()` so it can be unit-tested without
 * opening PGlite (see __tests__/media-storage-selection.test.ts).
 *
 * Runtime switch (mirrors the DATABASE_URL / Clerk / GROQ_API_KEY switches in build()): in PROD,
 * the host sets the four R2_* vars and we persist audio to Cloudflare R2 — the Vercel/serverless
 * filesystem is ephemeral, so FilesystemMediaStorage would silently lose every uploaded recording.
 * Anywhere those vars are absent — local dev, CI — we stay on the filesystem store so `pnpm dev`
 * works with no object-store to provision.
 *
 * FAIL LOUD on PARTIAL config: if SOME (but not all four) R2 vars are set, we THROW rather than
 * silently falling back to the ephemeral filesystem store. A half-configured prod deploy is the
 * data-loss trap this whole change exists to prevent — every upload would be lost with zero
 * signal. An immediate boot crash naming the missing vars is the correct, debuggable failure.
 * "Present" means non-blank: a whitespace-only value (e.g. "   ") does NOT count, so it can't
 * sneak a garbage accountId/bucket into the R2 client that would only fail at first network call.
 *
 * CRITICAL — single front door (see CLAUDE.md): the ONLY byte surface is the audited
 * /api/media/[id] route, which runs core authorization then calls `storage.getBytes(key)`.
 * `getUrl` is never called in apps/web. We construct R2MediaStorage WITHOUT a `publicBaseUrl`, so
 * the only URL it could ever produce is a presigned (signed, expiring) one — and even that is
 * never produced, because nothing here calls getUrl. (Filesystem sets publicBaseUrl only to
 * satisfy the MediaStorage interface; that "/media" string is NOT a real route — there is no
 * /media handler, only /api/media/[id] — so if getUrl were ever called it would return a path
 * that does NOT go through the audited route. The safety rests on getUrl being unused.)
 */
export function selectMediaStorage(env: StorageEnv): MediaStorage {
  const presentCount = R2_ENV_VARS.filter((name) => present(env[name])).length;

  if (presentCount > 0 && presentCount < R2_ENV_VARS.length) {
    const missing = R2_ENV_VARS.filter((name) => !present(env[name]));
    throw new Error(
      `Partial R2 configuration: ${presentCount} of ${R2_ENV_VARS.length} set. ` +
        `Missing: ${missing.join(", ")}. Set all four or none.`,
    );
  }

  if (presentCount === R2_ENV_VARS.length) {
    return new R2MediaStorage({
      accountId: env.R2_ACCOUNT_ID!.trim(),
      accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
      bucket: env.R2_BUCKET!.trim(),
      // publicBaseUrl intentionally omitted — do NOT set it; see the note above.
    });
  }

  return new FilesystemMediaStorage({
    baseDir: anchor(env.CHRONICLE_MEDIA_DIR ?? "./.media"),
    publicBaseUrl: "/media",
  });
}

type Runtime = {
  db: Database;
  storage: MediaStorage;
  auth: AuthProvider;
  /**
   * The bare language model (real Anthropic adapter when ANTHROPIC_API_KEY is set, else the
   * deterministic mock). Exposed for the non-pipeline LLM call sites — intake single-field
   * extraction (/hub/about-you) and post-approval biographical augmentation — which need a
   * LanguageModel directly, not a full transcribe→render Pipeline.
   */
  languageModel: LanguageModel;
  /**
   * The bare transcriber (real Groq Whisper adapter when GROQ_API_KEY is set, else the
   * deterministic mock). Exposed for the non-pipeline transcription call site — intake audio
   * capture (/hub/about-you) — which transcribes a single short clip directly, not through a
   * full transcribe→render Pipeline.
   */
  transcriber: Transcriber;
  /**
   * Build a FRESH pipeline (its own in-process JobQueue) for one transcribe→render run. This is a
   * FACTORY, not a singleton, on purpose: the in-process queue's `drain()` has a single-flight
   * re-entrancy guard sized for one async call tree. If two concurrent `shareAnswerAction` requests
   * shared one queue, the second's `drain()` would no-op while the first is draining and could then
   * approve a story still in `draft` (illegal transition → stuck `pending_approval`). A per-call
   * pipeline isolates each approval. (Production's durable Inngest queue is exempt; this is the
   * dev/CI in-process path.) The vendor adapters are stateless, so they are built once and reused.
   */
  newPipeline: () => Pipeline;
  /**
   * Dispatch the transcribe→render pipeline for a freshly-ingested story. The SINGLE entrypoint
   * the capture call sites use — it hides the durable-vs-synchronous decision:
   *   - Inngest configured (prod): enqueue onto the shared Inngest pipeline and return (Inngest
   *     drives the stages out-of-band).
   *   - Inngest unconfigured (dev/CI): build a fresh in-process pipeline and run it to completion
   *     in-request, exactly as the call sites did before this seam existed.
   * See `lib/dispatch-pipeline.ts`.
   */
  dispatchPipeline: DispatchPipeline;
  /**
   * True when `INNGEST_EVENT_KEY` is set, i.e. `dispatchPipeline` takes the durable enqueue path.
   * (In prod the serve route ALSO needs `INNGEST_SIGNING_KEY`; see `lib/inngest-config.ts`.)
   */
  inngestConfigured: boolean;
  /**
   * The Inngest client + the registered stage `functions`, for the `/api/inngest` serve route to
   * mount via `serve({ client, functions })`. Present ONLY when `inngestConfigured` is true — the
   * serve route must construct nothing of its own (one client per process). `undefined` in
   * dev/CI, where there is no durable queue to serve.
   */
  inngest?: { client: Inngest; functions: InngestFunction.Any[] };
};

// Survive HMR in dev: cache on globalThis so we don't reopen PGlite on every reload.
const globalForRuntime = globalThis as unknown as {
  __chronicleRuntime?: Promise<Runtime>;
};

// PGlite (Node) does not create the data directory itself — pre-create it so a fresh clone
// can boot without manual `mkdir`. Same idea for the media dir.
// Node 24 on Windows can spuriously throw ENOENT from `mkdirSync(p, {recursive:true})` even
// when the directory exists — guard with existsSync and swallow non-fatal failures (we
// re-verify with statSync at the end so a truly missing dir still surfaces).
function ensureDir(p: string): void {
  try {
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true });
    }
  } catch (err) {
    const exists = existsSync(p) && statSync(p).isDirectory();
    if (!exists) throw err;
  }
}

async function build(): Promise<Runtime> {
  // Runtime switch: in PROD, hosts set DATABASE_URL (Supabase / Neon / any managed Postgres)
  // and we use the postgres-js Drizzle adapter. Otherwise — local dev, CI, anywhere unset —
  // stay on PGlite so `pnpm dev` keeps working with no external Postgres to provision.
  let db: Database;
  if (process.env.DATABASE_URL) {
    db = createPostgresDatabase(process.env.DATABASE_URL);
    // First-boot bootstrap only, and opt-in: every Next.js cold start AND every HMR cycle would
    // otherwise hammer `applySchemaToPostgres`. It applies the schema only if absent (never drops);
    // for bootstrapping a fresh Supabase/Neon project. Set `CHRONICLE_RUN_MIGRATIONS=1` to run it.
    if (db.$postgres && process.env.CHRONICLE_RUN_MIGRATIONS === "1") {
      await applySchemaToPostgres(db.$postgres);
    }
    // Schema-drift detection lives at the DEPLOY GATE, not here. It used to run on every cold start
    // (assertPostgresSchemaParity), but a request-path guard is the wrong venue: (1) ANY failure —
    // including a transient introspection error or a missing build asset — takes down the WHOLE app,
    // a strictly larger blast radius than the targeted Postgres 42703 it was preventing; (2) it read
    // drizzle/schema.sql off disk on every cold start, coupling every request to a build asset the
    // serverless bundle didn't trace (that IS the outage this replaced). The parity check now runs
    // once, before deploy, in the Vercel build command (see apps/web/vercel.json →
    // `pnpm --filter @chronicle/db db:check-parity` → packages/db/scripts/check-parity.ts): drift
    // fails the BUILD, so a schema-behind database can never reach production instead of 500ing a
    // live one.
  } else {
    ensureDir(DEV_DB_DIR);
    db = createPgliteDatabase(DEV_DB_DIR);
    // Single-schema model (no incremental migrations while the schema is molten): create the
    // schema if this dev DB is empty, otherwise leave it alone. Schema changes are picked up by
    // RESEEDING — the dev seed blows the DB away and re-applies the current schema (resetSchema).
    await applySchema(db.$pglite!);
  }
  // Env switch (R2 in prod, filesystem in dev) — see selectMediaStorage. The dev media dir is only
  // pre-created when we actually use the filesystem store: on Vercel/serverless the package dir is
  // read-only, so an unconditional mkdir there would throw at boot when R2 is configured.
  const storage = selectMediaStorage(process.env);
  if (storage instanceof FilesystemMediaStorage) {
    ensureDir(DEV_MEDIA_DIR);
  }
  // Runtime switch: production hosts set both Clerk keys with valid prefixes and get the Clerk
  // adapter; local dev and CI leave them unset (or use placeholders) and get the mock provider —
  // a real email+password store (`mock_auth_users`) so `pnpm dev` exercises the actual signup /
  // signin flow with no Clerk account. (The dev-cookie provider in auth.ts is kept for the
  // /dev/sign-in "act as seeded user" path.)
  const auth: AuthProvider = isClerkConfigured()
    ? createClerkAuthProvider(db)
    : createMockAuthProvider(db);
  // Runtime switch: when vendor API keys are present in env, use real adapters (Groq Whisper
  // for transcription, Anthropic Claude for story rendering). When keys are absent — local dev,
  // CI, or any environment without secrets — fall back to deterministic in-process mocks so
  // the pipeline can run end-to-end without any paid vendor call. Mirrors the Clerk-vs-mock
  // pattern above.
  const transcriberName = process.env.GROQ_API_KEY ? "groq-whisper" : "scripted-mock";
  const llmName = process.env.GROQ_API_KEY
    ? "groq-llm"
    : process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : "scripted-mock";
  // The logging wrappers are TRANSPARENT (see observability.ts): they observe each AI call's
  // input size / latency / model / output and re-throw on error, adding no behavior. Wrapping
  // here — once, at the wiring seam — means EVERY AI call through these instances is logged
  // (transcribe, story render, post-approval augmentation, intake extraction), no matter the
  // call site. Logging itself is gated in @chronicle/pipeline's logger (dev-on, prod/test-off).
  const transcriber = withTranscriberLogging(
    process.env.GROQ_API_KEY
      ? createGroqTranscriber({})
      : new ScriptedTranscriber({
          text: "(Dev mode: no GROQ_API_KEY set — this is placeholder transcript text so the pipeline can run end to end.)",
        }),
    transcriberName,
  );
  // Phase-1 verification pass: run EVERY LLM task on Groq (one model, minimal new surface) when a
  // GROQ_API_KEY is present — the same key already drives the Groq transcriber above, so setting it
  // exercises the whole transcribe→render pipeline on one vendor. `GROQ_LLM_MODEL` overrides the
  // adapter default (`llama-3.3-70b-versatile`) without a code change. Anthropic remains available
  // as a fallback when only ANTHROPIC_API_KEY is set; with neither, the deterministic mock runs.
  const languageModel = withLanguageModelLogging(
    process.env.GROQ_API_KEY
      ? createGroqLanguageModel(
          process.env.GROQ_LLM_MODEL ? { model: process.env.GROQ_LLM_MODEL } : {},
        )
      : process.env.ANTHROPIC_API_KEY
        ? createAnthropicLanguageModel({})
        : new ScriptedLanguageModel(),
    llmName,
  );
  // Make the silent mock-fallback visible: a misplaced key (e.g. left in the monorepo-root .env,
  // which `next dev` does not load) means the pipeline quietly runs on scripted stubs. Log which
  // adapters are actually live so "am I on real AI?" is answerable from the dev console.
  // eslint-disable-next-line no-console
  console.info(`[chronicle] live adapters → transcriber=${transcriberName} languageModel=${llmName}`);
  // Factory: each call gets a fresh pipeline with its own in-process queue (see Runtime type).
  const newPipeline = (): Pipeline =>
    createPipeline({ db, storage, transcriber, languageModel });

  // Runtime switch: when INNGEST_EVENT_KEY is present (prod durable path), build ONE module-scope-
  // shared Inngest pipeline. createPipeline registers the REAL transcribe/render_story handlers
  // onto whatever JobQueue it is given, so wiring the Inngest adapter here means the adapter's
  // `functions` getter carries the real stage handlers — that array is what the /api/inngest serve
  // route mounts. We read the `functions` AFTER createPipeline returns (handlers are registered in
  // its constructor). Absent the key — dev, CI, no secrets — we leave this undefined and
  // dispatchPipeline falls back to the synchronous in-process path (newPipeline). Mirrors the
  // Clerk-vs-mock / Groq-vs-mock switches above.
  const inngestConfigured = isInngestConfigured();
  let inngest: Runtime["inngest"];
  let inngestPipeline: Pipeline | undefined;
  if (inngestConfigured) {
    // Fail-fast on the half-configured signing-key trap BEFORE constructing anything: an event key
    // without a signing key would enqueue + register but never execute (silent forever-draft).
    assertInngestServeable();
    // One client per process. eventKey defaults to INNGEST_EVENT_KEY inside the adapter, but we
    // pass the explicit client so the serve route reuses THIS instance (never a second client).
    const client = new Inngest({
      id: INNGEST_APP_ID,
      ...(process.env.INNGEST_EVENT_KEY ? { eventKey: process.env.INNGEST_EVENT_KEY } : {}),
    });
    const jobQueue = createInngestJobQueue({ client });
    inngestPipeline = createPipeline({ db, storage, transcriber, languageModel, jobQueue });
    inngest = { client, functions: jobQueue.functions };
  }

  // Single dispatch helper the capture call sites use. Branch selection lives in the pure
  // makeDispatchPipeline (unit-tested in dispatch-pipeline.test.ts).
  const dispatchPipeline = makeDispatchPipeline({
    inngestConfigured,
    newPipeline,
    ...(inngestPipeline ? { inngestPipeline } : {}),
  });

  return {
    db,
    storage,
    auth,
    languageModel,
    transcriber,
    newPipeline,
    dispatchPipeline,
    inngestConfigured,
    ...(inngest ? { inngest } : {}),
  };
}

export function getRuntime(): Promise<Runtime> {
  // If a previous build() rejected (e.g. transient mkdir failure during dev), don't cache the
  // poison — clear the slot on failure so the next request retries from scratch. There is a
  // benign TOCTOU here: two simultaneous callers seeing `undefined` will both call build() and
  // the second assignment wins; under PGlite's per-dir file lock the loser would fail at init.
  // Acceptable under `next dev` (single Node worker) — fix is `globalThis.__chronicleRuntime ??=`
  // semantics if we ever serve from a multi-worker dev runtime.
  if (!globalForRuntime.__chronicleRuntime) {
    const p = build();
    globalForRuntime.__chronicleRuntime = p;
    p.catch(() => {
      if (globalForRuntime.__chronicleRuntime === p) {
        globalForRuntime.__chronicleRuntime = undefined;
      }
    });
  }
  return globalForRuntime.__chronicleRuntime;
}
