/**
 * Inngest serve route — the HTTP surface Inngest's runtime (cloud or `inngest-cli dev`) calls to
 * SYNC the registered functions and INVOKE each stage. This is the only place outside
 * `@chronicle/queue-inngest` allowed to import the `inngest` SDK; apps/web is not scanned by the
 * vendor-SDK guard (which covers packages/{core,db,storage,capture,pipeline,interviewer}).
 *
 * ## Why the lazy/memoized handler
 *
 * `serve({ client, functions })` needs the runtime's Inngest client + registered stage functions,
 * but those are produced by `getRuntime()` — an ASYNC builder (it boots PGlite / managed Postgres
 * and wires the real adapters). Next.js route modules must export `GET`/`POST`/`PUT` STATICALLY at
 * import time, so we cannot `await getRuntime()` at module top level. Instead we build the
 * `serve()` handler lazily on the first request (after `await getRuntime()`), memoize it, and have
 * thin exported handlers delegate to it. The `serve()` object form returns `{ GET, POST, PUT }`
 * (confirmed against inngest@3.54.2 via Context7) — Inngest uses PUT to register/sync, POST to
 * invoke a function, GET to introspect.
 *
 * The signing key is a serve()-only concern (it authenticates Inngest's inbound calls); we pass
 * `INNGEST_SIGNING_KEY` explicitly (serve also reads it from env on its own, but being explicit
 * documents the dependency). The Inngest CLIENT comes from the runtime — we construct nothing here.
 *
 * If Inngest is not configured (dev/CI: no INNGEST_EVENT_KEY), `runtime.inngest` is undefined.
 * That is not an error condition for this route — dev drives the pipeline synchronously and never
 * registers an Inngest app — so we respond 503 rather than throw, making the misconfiguration
 * legible if something does hit `/api/inngest` without the durable queue wired up.
 */
import { serve } from "inngest/next";
import { getRuntime } from "@/lib/runtime";

// Node runtime: the runtime singleton boots PGlite / postgres-js and the pipeline adapters, none of
// which run on the Edge runtime.
export const runtime = "nodejs";

type Handler = (req: Request) => Promise<Response> | Response;
interface ServeHandlers {
  GET: Handler;
  POST: Handler;
  PUT: Handler;
}

// Memoize the built handlers across requests (and across HMR isn't a concern — route modules are
// re-imported, but getRuntime() itself caches on globalThis). A single in-flight build is shared
// via the promise so concurrent first requests don't each build a serve handler.
let handlersPromise: Promise<ServeHandlers | null> | undefined;

async function buildHandlers(): Promise<ServeHandlers | null> {
  const rt = await getRuntime();
  if (!rt.inngest) return null; // Inngest not configured in this environment.
  const built: unknown = serve({
    client: rt.inngest.client,
    functions: rt.inngest.functions,
    ...(process.env.INNGEST_SIGNING_KEY
      ? { signingKey: process.env.INNGEST_SIGNING_KEY }
      : {}),
  });
  // Runtime boundary guard instead of a blind `as unknown as` cast: if a future inngest/next
  // changes serve()'s return shape, fail loudly HERE (at build, naming the problem) rather than
  // crashing later with an opaque "handlers[method] is not a function" on a live request.
  if (!isServeHandlers(built)) {
    throw new Error(
      "inngest/next serve() did not return the expected { GET, POST, PUT } handlers — " +
        "the SDK return shape may have changed. Check the installed `inngest` version.",
    );
  }
  return built;
}

/** Narrowing guard for the serve() return value (see buildHandlers). */
function isServeHandlers(value: unknown): value is ServeHandlers {
  if (typeof value !== "object" && typeof value !== "function") return false;
  if (value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.GET === "function" &&
    typeof v.POST === "function" &&
    typeof v.PUT === "function"
  );
}

function getHandlers(): Promise<ServeHandlers | null> {
  if (!handlersPromise) {
    handlersPromise = buildHandlers().catch((err) => {
      // Don't cache a poisoned build — clear so the next request retries from scratch.
      handlersPromise = undefined;
      throw err;
    });
  }
  return handlersPromise;
}

async function dispatch(method: keyof ServeHandlers, req: Request): Promise<Response> {
  const handlers = await getHandlers();
  if (!handlers) {
    return new Response("Inngest is not configured in this environment.", { status: 503 });
  }
  return handlers[method](req);
}

export async function GET(req: Request): Promise<Response> {
  return dispatch("GET", req);
}

export async function POST(req: Request): Promise<Response> {
  return dispatch("POST", req);
}

export async function PUT(req: Request): Promise<Response> {
  return dispatch("PUT", req);
}
