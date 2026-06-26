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
  // The repo lives on Google Drive, whose filesystem breaks Next's build-worker writes
  // (EINVAL). Allow redirecting the build output off-Drive via env for a clean build/run.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
