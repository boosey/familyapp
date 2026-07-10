CREATE TABLE "google_photos_connections" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"google_account_email" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "google_photos_connections" ADD CONSTRAINT "google_photos_connections_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;