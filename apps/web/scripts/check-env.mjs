/**
 * Deploy-gate critical-env check — run in the Vercel BUILD command, before `next build`
 * (see apps/web/vercel.json), alongside the schema-parity gate.
 *
 * WHY THIS EXISTS
 * ---------------
 * The direct-to-storage upload flow (issue #20) requires ALBUM_UPLOAD_TICKET_SECRET in production;
 * upload-ticket.ts THROWS at runtime when it is unset on Vercel. Because nothing verified it at build
 * time, a missing secret shipped green and then failed EVERY device upload at runtime (the tile went
 * to "Tap to retry"), visible only in the runtime error logs. This gate turns that whole class of
 * failure — a required prod secret that was never provisioned — into a loud BUILD failure instead of a
 * silent runtime outage. Same philosophy as check-parity.ts: verify config once, before deploy, and
 * fail the deploy — never take a live app down from the request path.
 *
 * TIERS
 * -----
 *   REQUIRED    — absence breaks core functionality in production → non-zero exit → build fails.
 *   RECOMMENDED — optional / feature-gated / has a safe fallback → warn only, never fails the build.
 *
 * Keep the lists as the single, documented source of truth. Adding a new hard-required prod secret?
 * Add it to REQUIRED with a one-line `why`; the drift is then caught before it can reach production.
 *
 * PREVIEW vs PRODUCTION
 * ---------------------
 * A REQUIRED var may carry `previewOptional: true` — it is hard-required on a Production Vercel build
 * but downgraded to warn-only on a Preview build (`VERCEL_ENV === "preview"`). This exists for the
 * INNGEST_* keys: INNGEST_EVENT_KEY is deliberately NOT shared to Preview (a shared key let a preview
 * deploy hijack prod's durable queue — see the "Inngest hijack" incident), so enforcing it on Preview
 * would block every preview build. The pipeline (transcribe → render) simply doesn't run on previews;
 * that is acceptable for UI review. Production's guarantee is unchanged.
 *
 * Plain Node ESM (`.mjs`, run via `node`) — apps/web has no `tsx`, matching scripts/check-port.mjs.
 * The check itself is a pure `env -> result` function so it is unit-testable (see __tests__/check-env.test.ts).
 */
import { pathToFileURL } from "node:url";

/**
 * Vars whose absence breaks core functionality in production. Each has a runtime consumer that either
 * throws or silently degrades when the var is missing — this gate front-runs all of them.
 */
export const REQUIRED = [
  { name: "DATABASE_URL", why: "Postgres connection (Neon) — no DB, no app." },
  { name: "CLERK_SECRET_KEY", why: "Server-side auth; without it every request falls back to anonymous." },
  {
    name: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    why: "Client-side auth; build-time inlined — a missing key breaks sign-in.",
  },
  { name: "R2_ACCOUNT_ID", why: "Cloudflare R2 media storage (all four R2_* are required together)." },
  { name: "R2_ACCESS_KEY_ID", why: "Cloudflare R2 media storage." },
  { name: "R2_SECRET_ACCESS_KEY", why: "Cloudflare R2 media storage." },
  { name: "R2_BUCKET", why: "Cloudflare R2 media storage." },
  {
    name: "ALBUM_UPLOAD_TICKET_SECRET",
    why: "HMAC secret for direct-to-storage upload tickets (#20); upload-ticket.ts throws in prod without it.",
  },
  {
    name: "GROQ_API_KEY",
    why: "Transcription AND the Phase-1 LLM (story rendering, interviewer) both run on Groq; without it prod silently falls back to scripted mocks.",
  },
  {
    name: "INNGEST_EVENT_KEY",
    why: "Durable job queue — the pipeline (transcribe → render) runs on it.",
    previewOptional: true,
  },
  {
    name: "INNGEST_SIGNING_KEY",
    why: "Durable job queue signature verification.",
    previewOptional: true,
  },
];

/**
 * Vars that are optional, feature-gated, or have a documented safe fallback. A missing one is worth a
 * heads-up in the build log but must NOT fail the deploy.
 */
export const RECOMMENDED = [
  {
    name: "ANTHROPIC_API_KEY",
    why: "Optional LLM fallback; prod runs LLM on GROQ_API_KEY (runtime.ts) and only uses Anthropic when Groq is unset.",
  },
  {
    name: "GOOGLE_PHOTOS_OAUTH_STATE_SECRET",
    why: "Google Photos import is feature-gated and has a dev fallback; set a dedicated secret in prod.",
  },
  { name: "APP_BASE_URL", why: "Absolute base URL for links/redirects; falls back to inferred origin." },
  { name: "NEXT_PUBLIC_SENTRY_DSN", why: "Error observability; absence only means no Sentry reporting." },
];

/** A value counts as present only when it is a non-empty, non-whitespace string. */
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Only enforce on a durable deploy — a Vercel build (VERCEL set) or any build pointed at a real
 * database (DATABASE_URL set). A bare local `next build` with neither must not fail on prod-only
 * secrets. Mirrors the prod-detection in upload-ticket.ts / runtime.ts.
 */
export function shouldEnforce(env) {
  return present(env.VERCEL) || present(env.DATABASE_URL);
}

/**
 * Pure check: partition REQUIRED / RECOMMENDED into present vs missing. `ok` reflects REQUIRED only.
 * The CLI wrapper maps `ok` to the exit code; RECOMMENDED never affects it.
 *
 * On a Preview build (`VERCEL_ENV === "preview"`), REQUIRED vars flagged `previewOptional` are
 * downgraded to warn-only: they never fail the build and instead ride along in `missingRecommended`.
 * Everywhere else (Production, or a durable DATABASE_URL build) they are hard-required as usual.
 */
export function checkEnv(env) {
  const isPreview = env.VERCEL_ENV === "preview";
  const enforced = REQUIRED.filter((v) => !(isPreview && v.previewOptional));
  const downgraded = isPreview ? REQUIRED.filter((v) => v.previewOptional) : [];

  const missingRequired = enforced.filter((v) => !present(env[v.name]));
  const missingRecommended = [...RECOMMENDED, ...downgraded].filter((v) => !present(env[v.name]));
  const ok = missingRequired.length === 0;
  return { ok, missingRequired, missingRecommended };
}

/** CLI entry: check process.env, warn on recommended, exit 0 (ok / not enforced) or 1 (missing required). */
function main() {
  const enforce = shouldEnforce(process.env);
  const { ok, missingRequired, missingRecommended } = checkEnv(process.env);

  for (const { name, why } of missingRecommended) {
    console.warn(`[check-env] ⚠ recommended env not set: ${name} — ${why}`);
  }

  if (!enforce) {
    console.log(
      "[check-env] ✓ local build (no VERCEL / DATABASE_URL) — skipping required-env enforcement.",
    );
    process.exit(0);
  }

  if (ok) {
    console.log(`[check-env] ✓ all ${REQUIRED.length} required production env vars are set.`);
    process.exit(0);
  }

  console.error("[check-env] ✗ missing required production env var(s):\n");
  for (const { name, why } of missingRequired) {
    console.error(`  - ${name} — ${why}`);
  }
  console.error(
    "\nSet the above in the Vercel project (Settings → Environment Variables) for Production " +
      "(and Preview), then redeploy. This gate fails the build so the outage can't reach runtime.",
  );
  process.exit(1);
}

// Only run the CLI when invoked directly (`node scripts/check-env.mjs`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
