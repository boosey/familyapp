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

export default nextConfig;
