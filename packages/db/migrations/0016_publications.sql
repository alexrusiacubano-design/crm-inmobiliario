CREATE TYPE "public"."ad_level" AS ENUM('basic', 'silver', 'gold', 'premium');--> statement-breakpoint
CREATE TYPE "public"."exchange_source" AS ENUM('manual', 'bcu');--> statement-breakpoint
CREATE TYPE "public"."portal" AS ENUM('infocasas', 'mercadolibre', 'gallito', 'website', 'other');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('published', 'paused', 'expired', 'removed');--> statement-breakpoint
CREATE TABLE "exchange_rate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"date" date NOT NULL,
	"uyu_per_usd" numeric(10, 4) NOT NULL,
	"source" "exchange_source" NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"portal" "portal" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"account_ref" text,
	"quotas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feed_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_publication" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"portal" "portal" NOT NULL,
	"level" "ad_level" DEFAULT 'basic' NOT NULL,
	"status" "publication_status" DEFAULT 'published' NOT NULL,
	"external_id" text,
	"url" text,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" date,
	"views" integer,
	"contacts" integer,
	"notes" text,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acquisition" ADD COLUMN "padron" text;--> statement-breakpoint
ALTER TABLE "acquisition" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "acquisition" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "acquisition" ADD COLUMN "source_portal" text;--> statement-breakpoint
ALTER TABLE "acquisition" ADD COLUMN "portal_url" text;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "padron" text;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_account" ADD CONSTRAINT "portal_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_publication" ADD CONSTRAINT "property_publication_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_publication" ADD CONSTRAINT "property_publication_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_publication" ADD CONSTRAINT "property_publication_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rate_org_date_uq" ON "exchange_rate" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_account_org_portal_uq" ON "portal_account" USING btree ("organization_id","portal");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_account_feed_token_uq" ON "portal_account" USING btree ("feed_token");--> statement-breakpoint
CREATE UNIQUE INDEX "property_publication_property_portal_uq" ON "property_publication" USING btree ("property_id","portal");--> statement-breakpoint
CREATE INDEX "property_publication_org_status_idx" ON "property_publication" USING btree ("organization_id","portal","status");--> statement-breakpoint
ALTER TABLE "property_publication" ADD CONSTRAINT "property_publication_counts" CHECK (coalesce("views", 0) >= 0 AND coalesce("contacts", 0) >= 0);
--> statement-breakpoint
ALTER TABLE "exchange_rate" ADD CONSTRAINT "exchange_rate_positive" CHECK ("uyu_per_usd" > 0);
--> statement-breakpoint
-- Gerentes (su sucursal) y directores (toda la organización) gestionan publicaciones en portales.
INSERT INTO "role_permission" ("role_id", "permission_code", "scope")
SELECT r."id", 'publication.manage', CASE r."key" WHEN 'director' THEN 'org' ELSE 'branch' END::"permission_scope"
FROM "role" r
WHERE r."key" IN ('director', 'manager') AND r."is_system" = true
ON CONFLICT DO NOTHING;
