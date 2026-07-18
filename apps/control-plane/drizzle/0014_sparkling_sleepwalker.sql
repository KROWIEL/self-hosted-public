DO $$ BEGIN
 CREATE TYPE "public"."catalog_tier" AS ENUM('free', 'homelab');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deploy_kind" AS ENUM('git', 'image', 'compose');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalog_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"icon" text,
	"min_tier" "catalog_tier" DEFAULT 'free' NOT NULL,
	"deploy_kind" "deploy_kind" NOT NULL,
	"image" text,
	"compose_yaml" text,
	"compose_git_url" text,
	"compose_file" text,
	"default_port" integer,
	"recommended_volumes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"env_defaults" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_apps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "repo_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "deploy_kind" "deploy_kind" DEFAULT 'git' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "compose_file" text DEFAULT 'docker-compose.yml';--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "compose_yaml" text;