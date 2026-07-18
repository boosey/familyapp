import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { sharedTest } from "../../vitest.shared";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  test: { ...sharedTest },
  resolve: {
    alias: {
      "@chronicle/db/content": p("../db/src/content.ts"),
      "@chronicle/db/kinship": p("../db/src/kinship.ts"),
      "@chronicle/db/schema": p("../db/src/schema-public.ts"),
      "@chronicle/db": p("../db/src/index.ts"),
      "@chronicle/core": p("../core/src/index.ts"),
      "@chronicle/storage": p("../storage/src/index.ts"),
    },
  },
});
