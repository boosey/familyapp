/**
 * GUARDED kinship tables (ADR-0016) — the family-tree edge ledgers.
 *
 * Reachable ONLY through this subpath, exactly like `@chronicle/db/content` guards Story/Media.
 * An architecture test (packages/core/test/architecture.test.ts) fails CI if any production source
 * file outside the audited kinship allowlist imports it. All kinship reads/writes go through
 * `@chronicle/core`'s kinship-repository — its OWN authorized surface, parallel to (and NOT part of)
 * the Story front door: kinship is a distinct data category and never grants content access
 * (ADR-0016). The enum objects are exported here too (for typed inserts / enumValues); the derived
 * TYPES (KinshipEdgeType, …) are freely importable from `@chronicle/db`.
 */
export {
  kinshipAssertions,
  kinshipSubjectHides,
  kinshipEdgeTypeEnum,
  kinshipNatureEnum,
  kinshipStateEnum,
} from "./schema";
