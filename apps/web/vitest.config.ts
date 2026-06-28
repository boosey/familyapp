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
      "@chronicle/transcribe-groq": fileURLToPath(
        new URL("../../packages/transcribe-groq/src/index.ts", import.meta.url),
      ),
      "@chronicle/llm-anthropic": fileURLToPath(
        new URL("../../packages/llm-anthropic/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: ["__tests__/**/*-shim.ts", "node_modules/**"],
  },
});
