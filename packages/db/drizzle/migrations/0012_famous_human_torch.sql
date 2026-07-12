CREATE TYPE "public"."person_sex" AS ENUM('male', 'female', 'unknown');--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "sex" "person_sex" DEFAULT 'unknown';