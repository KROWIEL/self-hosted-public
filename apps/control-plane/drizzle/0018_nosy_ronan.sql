CREATE TABLE IF NOT EXISTS "tls_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"acme_email" text DEFAULT '' NOT NULL,
	"dns_provider" text DEFAULT 'cloudflare' NOT NULL,
	"wildcard_enabled" boolean DEFAULT false NOT NULL,
	"cloudflare_token_enc" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "cert_source" text DEFAULT 'acme' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "custom_cert_enc" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "custom_key_enc" text;