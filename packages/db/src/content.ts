/**
 * GUARDED content tables — the expressive artifacts the spec puts behind the single front door.
 *
 * `stories` and `media` table objects are reachable ONLY through this subpath, and an
 * architecture test (packages/core/test/architecture.test.ts) fails CI if any production source
 * file outside the audited allowlist imports it. All Story/Media reads go through
 * @chronicle/core's authorization function; all Story/Media writes go through @chronicle/core's
 * repository. Identity/relationship tables (persons, memberships, ...) are NOT here — they live
 * in @chronicle/db/schema and are freely importable.
 */
export { media, stories } from "./schema";
