ALTER TABLE "api_tokens" ADD COLUMN "scopes" text DEFAULT 'full' NOT NULL;
--> statement-breakpoint
-- Preserve prior behaviour for tokens that predate scopes: before M4 any PAT
-- from an admin user could reach admin routes, so grant existing rows the
-- 'admin' scope. New tokens default to 'full' (no admin) via the column default.
UPDATE "api_tokens" SET "scopes" = 'full,admin';