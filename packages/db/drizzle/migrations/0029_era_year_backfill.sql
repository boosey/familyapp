-- ADR-0026 (#247): backfill the legacy `era_year` integer into the Story date occurrence model.
-- Each stored era year becomes a year-aligned period (occurred_date = YYYY-01-01,
-- occurred_end_date = YYYY-12-31) so it displays as that year ("1943"), with the provenance note
-- recording where the value came from. Hand-written data migration (no schema change):
-- `era_year` itself is NOT dropped here — the column contract retires it separately.
-- Guarded on `occurred_kind IS NULL` so it never clobbers a Story date that already exists
-- (and is a safe no-op on a second run).
UPDATE "stories"
SET "occurred_kind" = 'period',
    "occurred_date" = make_date("era_year", 1, 1),
    "occurred_end_date" = make_date("era_year", 12, 31),
    "occurred_provenance" = 'migrated from eraYear'
WHERE "era_year" IS NOT NULL
  AND "occurred_kind" IS NULL;
