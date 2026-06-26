import { defineConfig } from "drizzle-kit";

// Table DDL is generated from schema.ts (the single source of truth). Triggers, the
// append-only enforcement, the media-immutability guard, and the partial unique index live in
// drizzle/custom/triggers.sql (things drizzle-kit does not model) and are applied after.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
