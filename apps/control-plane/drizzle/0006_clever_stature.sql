CREATE TABLE IF NOT EXISTS "sso_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer" text DEFAULT '' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret_enc" text DEFAULT '' NOT NULL,
	"allowed_domains" text DEFAULT '' NOT NULL,
	"auto_create" boolean DEFAULT true NOT NULL,
	"button_label" text DEFAULT 'Sign in with SSO' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
