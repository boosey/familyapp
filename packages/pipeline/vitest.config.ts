import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@chronicle/db/content": p("../db/src/content.ts"),
      "@chronicle/db/schema": p("../db/src/schema-public.ts"),
      "@chronicle/db": p("../db/src/index.ts"),
      "@chronicle/core/pipeline": p("../core/src/pipeline.ts"),
      "@chronicle/core": p("../core/src/index.ts"),
      "@chronicle/storage": p("../storage/src/index.ts"),
    },
  },
});
