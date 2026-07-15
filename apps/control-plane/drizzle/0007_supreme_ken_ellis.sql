CREATE TABLE IF NOT EXISTS "preview_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_service_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"host" text,
	"status" text DEFAULT 'CREATING' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preview_environments_service_id_unique" UNIQUE("service_id")
);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "preview_of" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_parent_service_id_services_id_fk" FOREIGN KEY ("parent_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "preview_environments" ADD CONSTRAINT "preview_environments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "services" ADD CONSTRAINT "services_preview_of_services_id_fk" FOREIGN KEY ("preview_of") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
