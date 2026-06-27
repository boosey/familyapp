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
      "@chronicle/db/content": fileURLToPath(
        new URL("../../packages/db/src/content.ts", import.meta.url),
      ),
      "@chronicle/db/schema": fileURLToPath(
        new URL("../../packages/db/src/schema-public.ts", import.meta.url),
      ),
      "@chronicle/db": fileURLToPath(
        new URL("../../packages/db/src/index.ts", import.meta.url),
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
    },
  },
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: ["__tests__/**/*-shim.ts", "node_modules/**"],
  },
});
