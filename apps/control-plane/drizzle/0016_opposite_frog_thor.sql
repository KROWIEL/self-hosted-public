ALTER TABLE "services" ADD COLUMN "build_mode" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
UPDATE "services" SET "build_mode" = 'dockerfile' WHERE "use_repo_dockerfile" = true;
