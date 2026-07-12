import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Workspace packages are referenced via TS source aliases (the repo filesystem doesn't support
 * the symlinks pnpm wants). Mirrors the alias map in `tsconfig.json` so vitest can resolve them.
 */
export default defineConfig({
  resolve: {
    alias: {
      // `import "server-only"` is a Next.js compile-time marker; under vitest it throws because
      // it assumes a React Server Components environment. Alias to an empty module.
      "server-only": fileURLToPath(
        new URL("./__tests__/server-only-shim.ts", import.meta.url),
      ),
      // App-root alias (mirrors tsconfig "@/*") so tests can import route handlers / lib by "@/…".
      // Key has no trailing slash so the alias plugin treats it as a path-boundary prefix.
      "@": fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]$/, ""),
      "@chronicle/db/kinship": fileURLToPath(
        new URL("../../packages/db/src/kinship.ts", import.meta.url),
      ),
      "@chronicle/db/content": fileURLToPath(
        new URL("../../packages/db/src/content.ts", import.meta.url),
      ),
      "@chronicle/db/schema": fileURLToPath(
        new URL("../../packages/db/src/schema-public.ts", import.meta.url),
      ),
      "@chronicle/db": fileURLToPath(
        new URL("../../packages/db/src/index.ts", import.meta.url),
      ),
      // More specific subpath BEFORE the package root so plugin-alias matches it first
      // (mirrors the @chronicle/db/content vs @chronicle/db ordering above).
      "@chronicle/core/pipeline": fileURLToPath(
        new URL("../../packages/core/src/pipeline.ts", import.meta.url),
      ),
      "@chronicle/core/kinship-derive": fileURLToPath(
        new URL("../../packages/core/src/kinship-derive.ts", import.meta.url),
      ),
      "@chronicle/core": fileURLToPath(
        new URL("../../packages/core/src/index.ts", import.meta.url),
      ),
      "@chronicle/capture": fileURLToPath(
        new URL("../../packages/capture/src/index.ts", import.meta.url),
      ),
      "@chronicle/storage": fileURLToPath(
        new URL("../../packages/storage/src/index.ts", import.meta.url),
      ),
      "@chronicle/pipeline": fileURLToPath(
        new URL("../../packages/pipeline/src/index.ts", import.meta.url),
      ),
      "@chronicle/interviewer": fileURLToPath(
        new URL("../../packages/interviewer/src/index.ts", import.meta.url),
      ),
      "@chronicle/transcribe-groq": fileURLToPath(
        new URL("../../packages/transcribe-groq/src/index.ts", import.meta.url),
      ),
      "@chronicle/llm-anthropic": fileURLToPath(
        new URL("../../packages/llm-anthropic/src/index.ts", import.meta.url),
      ),
      "@chronicle/llm-groq": fileURLToPath(
        new URL("../../packages/llm-groq/src/index.ts", import.meta.url),
      ),
      "@chronicle/queue-inngest": fileURLToPath(
        new URL("../../packages/queue-inngest/src/index.ts", import.meta.url),
      ),
      // More specific subpath BEFORE the package root (client-safe picker helpers only).
      "@chronicle/photos-google/picker": fileURLToPath(
        new URL("../../packages/photos-google/src/picker.ts", import.meta.url),
      ),
      "@chronicle/photos-google": fileURLToPath(
        new URL("../../packages/photos-google/src/index.ts", import.meta.url),
      ),
    },
  },
  // .tsx component tests render with the automatic JSX runtime (no `import React`).
  // The app tsconfig uses jsx:"preserve" for Next; esbuild needs an explicit transform here.
  esbuild: { jsx: "automatic" },
  test: {
    // Component tests are .tsx and opt into jsdom per-file via `// @vitest-environment jsdom`;
    // the default node environment is kept for the logic-only .ts suites.
    // Tests live under __tests__/ AND colocated beside the code they cover (the tree layout/relabel
    // logic suites sit in app/hub/tree/). Both roots are globbed so colocated suites run in CI too.
    include: [
      "__tests__/**/*.test.ts",
      "__tests__/**/*.test.tsx",
      "app/**/*.test.ts",
      "app/**/*.test.tsx",
    ],
    exclude: ["__tests__/**/*-shim.ts", "node_modules/**"],
  },
});
