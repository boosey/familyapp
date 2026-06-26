import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The repo lives on a filesystem that does not support the symlinks pnpm uses to link workspace
// packages, so workspace deps are resolved via aliases to their TS source instead of node_modules.
export default defineConfig({
  resolve: {
    alias: {
      "@chronicle/db": fileURLToPath(
        new URL("../db/src/index.ts", import.meta.url),
      ),
    },
  },
});
