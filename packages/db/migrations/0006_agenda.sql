CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'done', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('visit', 'meeting', 'call', 'reminder', 'task', 'other');--> statement-breakpoint
CREATE TYPE "public"."visit_outcome" AS ENUM('interested', 'second_visit', 'offer_intent', 'not_interested');--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"property_id" uuid,
	"assigned_user_id" uuid NOT NULL,
	"branch_id" uuid,
	"team_id" uuid,
	"outcome" "visit_outcome",
	"rating" integer,
	"feedback" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_event_org_start_idx" ON "calendar_event" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_org_assigned_idx" ON "calendar_event" USING btree ("organization_id","assigned_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_contact_idx" ON "calendar_event" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "calendar_event_property_idx" ON "calendar_event" USING btree ("organization_id","property_id");--> statement-breakpoint
-- Invariantes de la agenda.
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_range" CHECK ("ends_at" IS NULL OR "ends_at" >= "starts_at");
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_closed_consistency"
  CHECK (("status" = 'scheduled') = ("closed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_outcome_only_visits"
  CHECK ("outcome" IS NULL OR "type" = 'visit');
