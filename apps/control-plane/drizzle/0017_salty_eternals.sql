ALTER TABLE "offsite_config" ADD COLUMN "provider" text DEFAULT 's3' NOT NULL;--> statement-breakpoint
ALTER TABLE "offsite_config" ADD COLUMN "provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL;
