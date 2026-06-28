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
import { FilesystemMediaStorage, type MediaStorage } from "@chronicle/storage";
import {
  createPipeline,
  ScriptedTranscriber,
  ScriptedLanguageModel,
  type Pipeline,
} from "@chronicle/pipeline";
import { createGroqTranscriber } from "@chronicle/transcribe-groq";
import { createAnthropicLanguageModel } from "@chronicle/llm-anthropic";
import { type AuthProvider } from "./auth";
import { createClerkAuthProvider } from "./auth-clerk";
import { createMockAuthProvider } from "./auth-mock";
import { isClerkConfigured } from "./clerk-config";

export { isClerkConfigured };

// Anchor relative paths to the apps/web package dir, not process.cwd(). On Windows Next dev's
// recursive `mkdirSync` against a relative path occasionally ENOENTs even when the directory
// already exists, depending on which cwd Next chose. Absolute paths sidestep the class of issue.
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function anchor(p: string): string {
  return isAbsolute(p) ? p : resolve(PKG_DIR, p);
}

const DEV_DB_DIR = anchor(process.env.CHRONICLE_DB_DIR ?? "./.pglite/dev");
const DEV_MEDIA_DIR = anchor(process.env.CHRONICLE_MEDIA_DIR ?? "./.media");

type Runtime = {
  db: Database;
  storage: MediaStorage;
  auth: AuthProvider;
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
  ensureDir(DEV_MEDIA_DIR);
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
  } else {
    ensureDir(DEV_DB_DIR);
    db = createPgliteDatabase(DEV_DB_DIR);
    // Single-schema model (no incremental migrations while the schema is molten): create the
    // schema if this dev DB is empty, otherwise leave it alone. Schema changes are picked up by
    // RESEEDING — the dev seed blows the DB away and re-applies the current schema (resetSchema).
    await applySchema(db.$pglite!);
  }
  const storage = new FilesystemMediaStorage({
    baseDir: DEV_MEDIA_DIR,
    publicBaseUrl: "/media",
  });
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
  const transcriber = process.env.GROQ_API_KEY
    ? createGroqTranscriber({})
    : new ScriptedTranscriber({
        text: "(Dev mode: no GROQ_API_KEY set — this is placeholder transcript text so the pipeline can run end to end.)",
      });
  const languageModel = process.env.ANTHROPIC_API_KEY
    ? createAnthropicLanguageModel({})
    : new ScriptedLanguageModel();
  // Factory: each call gets a fresh pipeline with its own in-process queue (see Runtime type).
  const newPipeline = (): Pipeline =>
    createPipeline({ db, storage, transcriber, languageModel });
  return { db, storage, auth, newPipeline };
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
