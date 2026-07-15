CREATE TABLE IF NOT EXISTS "offsite_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"endpoint" text DEFAULT '' NOT NULL,
	"region" text DEFAULT 'us-east-1' NOT NULL,
	"bucket" text DEFAULT '' NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"access_key_id" text DEFAULT '' NOT NULL,
	"secret_key_enc" text DEFAULT '' NOT NULL,
	"force_path_style" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "offsite_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_id" uuid NOT NULL,
	"key" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"size_bytes" integer,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offsite_uploads_backup_id_unique" UNIQUE("backup_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "offsite_uploads" ADD CONSTRAINT "offsite_uploads_backup_id_backups_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
