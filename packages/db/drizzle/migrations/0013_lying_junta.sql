CREATE TABLE "photo_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"tagged_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"place_id" uuid NOT NULL,
	"tagged_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"tagged_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"exif_gps" jsonb,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_people" ADD CONSTRAINT "photo_people_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_people" ADD CONSTRAINT "photo_people_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_people" ADD CONSTRAINT "photo_people_tagged_by_person_id_persons_id_fk" FOREIGN KEY ("tagged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_places" ADD CONSTRAINT "photo_places_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_places" ADD CONSTRAINT "photo_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_places" ADD CONSTRAINT "photo_places_tagged_by_person_id_persons_id_fk" FOREIGN KEY ("tagged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_subjects" ADD CONSTRAINT "photo_subjects_photo_id_family_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."family_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_subjects" ADD CONSTRAINT "photo_subjects_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_subjects" ADD CONSTRAINT "photo_subjects_tagged_by_person_id_persons_id_fk" FOREIGN KEY ("tagged_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_family_id_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."families"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_created_by_person_id_persons_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "photo_people_photo_person_uq" ON "photo_people" USING btree ("photo_id","person_id");--> statement-breakpoint
CREATE INDEX "photo_people_photo_idx" ON "photo_people" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "photo_people_person_idx" ON "photo_people" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_places_photo_place_uq" ON "photo_places" USING btree ("photo_id","place_id");--> statement-breakpoint
CREATE INDEX "photo_places_photo_idx" ON "photo_places" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "photo_places_place_idx" ON "photo_places" USING btree ("place_id");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_subjects_photo_person_uq" ON "photo_subjects" USING btree ("photo_id","person_id");--> statement-breakpoint
CREATE INDEX "photo_subjects_photo_idx" ON "photo_subjects" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "photo_subjects_person_idx" ON "photo_subjects" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "places_family_name_uq" ON "places" USING btree ("family_id","name");--> statement-breakpoint
CREATE INDEX "places_family_idx" ON "places" USING btree ("family_id");