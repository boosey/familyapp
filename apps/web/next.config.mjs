import { fileURLToPath } from "node:url";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";

const projectDir = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages are TS source (no build step); transpile them. Next reads tsconfig `paths`
  // for resolution, which (in this no-symlink repo) points @chronicle/* at the source files.
  transpilePackages: [
    "@chronicle/db",
    "@chronicle/core",
    "@chronicle/capture",
    "@chronicle/storage",
  ],
  // @chronicle/db reads packages/db/drizzle/{schema,invariants}.sql at RUNTIME (migrate.ts →
  // schemaSql(), used by applySchema/resetSchema AND — the load-bearing case — the boot-time
  // assertPostgresSchemaParity guard that runs on every cold start in prod). Those `.sql` files are
  // plain assets read via `readFileSync(fileURLToPath(new URL(...)))`, which Next's file tracer
  // (@vercel/nft) does NOT follow — so on Vercel they were absent from the serverless bundle and the
  // guard crashed with `ENOENT ... schema.sql`, which /auth/callback caught and turned into
  // `/sign-in?error=callback` for every sign-in / create-family / hub load. Force them into the
  // trace. `outputFileTracingRoot` must reach the monorepo root for these sibling-package files to
  // be traceable; the include globs are resolved relative to THIS project dir (apps/web).
  outputFileTracingRoot: path.join(projectDir, "../.."),
  outputFileTracingIncludes: {
    "/**": ["../../packages/db/drizzle/*.sql"],
  },
  // Photo uploads (the Family album) POST their bytes through a Server Action, which Next caps at a
  // 1 MB request body by DEFAULT — far under a single phone photo (2–8 MB), let alone the multi-select
  // batch. Raise the cap so realistic uploads reach the action instead of being rejected at the RPC
  // transport before any of our code runs. NOTE: this is the FRAMEWORK cap; the hosting platform
  // (Vercel serverless functions) enforces its own ~4.5 MB request-body limit, so very large batches
  // still need the direct-to-storage (presigned-upload) path — tracked as a follow-up (ADR-0009).
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  // PGlite ships a wasm asset and uses Node APIs; keep server externals happy in dev.
  // The R2 media adapter (@chronicle/storage's r2.ts) pulls the AWS S3 SDK; it is server-only
  // (the media route is `runtime = "nodejs"`). Externalize it so Next doesn't try to bundle the
  // large, Node-API-using SDK into the server output.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
};

// Source-map upload is CONDITIONAL: it only runs when an auth token + org + project are present
// (set in the production CI/build env). Without them — local builds, CI prod builds without the
// secret — upload is disabled so the build still succeeds and never phones home.
//
// NOTE: even with source-map upload disabled, `withSentryConfig` still injects the build-time
// instrumentation wrap (OTel / server SDK loading, client init bundling, the request-error hook).
// That injected instrumentation is itself inert at runtime without a DSN (see the sentry.*.config
// and instrumentation files), but it means the options below stay load-bearing and auditable
// regardless of whether upload happens.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const sourceMapUploadEnabled = Boolean(
  sentryAuthToken && sentryOrg && sentryProject,
);

/** @type {import('@sentry/nextjs').SentryBuildOptions} */
const sentryBuildOptions = {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  // Quiet unless running in CI (mirrors Sentry's recommended default).
  silent: !process.env.CI,
  // Hard-disable upload + the bundler plugin's network calls unless fully configured.
  sourcemaps: { disable: !sourceMapUploadEnabled },
  // Skip Sentry's telemetry to the Sentry org during builds.
  telemetry: false,
  // Don't let the build auto-create Vercel cron monitors on deploy — opt in explicitly elsewhere
  // if/when we actually want them. (Nested under `webpack` since @sentry/nextjs deprecated the
  // top-level `automaticVercelMonitors`.)
  webpack: { automaticVercelMonitors: false },
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
