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
  // The R2 media adapter (@chronicle/storage's r2.ts) pulls the AWS S3 SDK; it is server-only
  // (the media route is `runtime = "nodejs"`). Externalize it so Next doesn't try to bundle the
  // large, Node-API-using SDK into the server output.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
};

export default nextConfig;
