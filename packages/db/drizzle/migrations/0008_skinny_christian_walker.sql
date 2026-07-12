-- ADR-0016: Person provenance (origin) & flexible identity.
-- Backfill is implicit: `ADD COLUMN ... DEFAULT 'self' NOT NULL` sets every existing persons row to
-- origin = 'self', and `identified` DEFAULT true sets them all identified — no separate UPDATE needed.
-- `spoken_name` is dropped NOT NULL alongside `display_name` so a nameless placeholder mention
-- (identified = false, no name, rendered from the relation) can exist; the AC named only display_name,
-- but the two name fields must move together for a truly nameless bridge node. No invariant/trigger
-- changes in this slice (origin-immutability is enforced by convention: no write path updates it).
CREATE TYPE "public"."person_origin" AS ENUM('self', 'invitee', 'mention');--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "display_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ALTER COLUMN "spoken_name" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "origin" "person_origin" DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "identified" boolean DEFAULT true NOT NULL;