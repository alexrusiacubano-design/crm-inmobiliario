CREATE TYPE "public"."match_status" AS ENUM('suggested', 'sent', 'interested', 'discarded');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'match_feedback' BEFORE 'visit';--> statement-breakpoint
CREATE TABLE "property_match" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"status" "match_status" DEFAULT 'suggested' NOT NULL,
	"score" integer NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"sent_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone,
	"status_changed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_status_changed_by_id_user_id_fk" FOREIGN KEY ("status_changed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_match_lead_property_uq" ON "property_match" USING btree ("lead_id","property_id");--> statement-breakpoint
CREATE INDEX "property_match_org_status_idx" ON "property_match" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "property_match_property_idx" ON "property_match" USING btree ("property_id");--> statement-breakpoint
ALTER TABLE "property_match" ADD CONSTRAINT "property_match_score_range" CHECK ("score" BETWEEN 0 AND 100);
