ALTER TABLE "nodes" ADD COLUMN "daemon_token_prev" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "daemon_token_rotated_at" timestamp;