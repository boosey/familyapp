import { withSentryConfig } from "@sentry/nextjs";

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
  // PGlite ships a wasm asset and uses Node APIs; keep server externals happy in dev.
  serverExternalPackages: ["@electric-sql/pglite"],
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
  // if/when we actually want them.
  automaticVercelMonitors: false,
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
