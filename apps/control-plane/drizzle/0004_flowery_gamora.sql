CREATE TABLE IF NOT EXISTS "branding_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"app_name" text DEFAULT 'Self-Hosted' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"accent_color" text DEFAULT '' NOT NULL,
	"hide_powered_by" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
