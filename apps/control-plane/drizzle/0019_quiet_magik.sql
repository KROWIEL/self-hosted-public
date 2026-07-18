CREATE TABLE IF NOT EXISTS "git_app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"webhook_secret_enc" text DEFAULT '' NOT NULL,
	"access_token_enc" text DEFAULT '' NOT NULL,
	"github_app_id" text,
	"github_private_key_enc" text,
	"parent_service_id" uuid,
	"repo_allowlist" text DEFAULT '' NOT NULL,
	"default_ttl_hours" integer DEFAULT 72 NOT NULL,
	"comment_on_pr" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pr_preview_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" text NOT NULL,
	"provider" text NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text,
	"branch" text NOT NULL,
	"head_sha" text,
	"preview_id" uuid,
	"preview_service_id" uuid,
	"comment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pr_preview_links_provider_repo_pr_uidx" UNIQUE("provider","repo","pr_number")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "git_app_installations" ADD CONSTRAINT "git_app_installations_parent_service_id_services_id_fk" FOREIGN KEY ("parent_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pr_preview_links" ADD CONSTRAINT "pr_preview_links_installation_id_git_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."git_app_installations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pr_preview_links" ADD CONSTRAINT "pr_preview_links_preview_id_preview_environments_id_fk" FOREIGN KEY ("preview_id") REFERENCES "public"."preview_environments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pr_preview_links" ADD CONSTRAINT "pr_preview_links_preview_service_id_services_id_fk" FOREIGN KEY ("preview_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
