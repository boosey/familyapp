import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sharedTest } from "../../vitest.shared";

// The repo lives on a filesystem that does not support the symlinks pnpm uses to link workspace
// packages, so workspace deps are resolved via aliases to their TS source instead of node_modules.
export default defineConfig({
  test: { ...sharedTest },
  resolve: {
    alias: {
      // Order matters: the more specific subpaths must come first.
      "@chronicle/db/content": fileURLToPath(
        new URL("../db/src/content.ts", import.meta.url),
      ),
      "@chronicle/db/kinship": fileURLToPath(
        new URL("../db/src/kinship.ts", import.meta.url),
      ),
      "@chronicle/db/schema": fileURLToPath(
        new URL("../db/src/schema-public.ts", import.meta.url),
      ),
      "@chronicle/db": fileURLToPath(
        new URL("../db/src/index.ts", import.meta.url),
      ),
    },
  },
});
