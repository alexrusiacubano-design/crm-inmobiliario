CREATE TYPE "public"."goal_metric" AS ENUM('visits_done', 'properties_listed', 'leads_attended', 'reservations', 'signed', 'sales_closed', 'rentals_closed');--> statement-breakpoint
CREATE TABLE "agent_goal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"metric" "goal_metric" NOT NULL,
	"monthly_target" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_stage_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_stage" "deal_stage",
	"to_stage" "deal_stage" NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_goal" ADD CONSTRAINT "agent_goal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_goal" ADD CONSTRAINT "agent_goal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_event" ADD CONSTRAINT "deal_stage_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_event" ADD CONSTRAINT "deal_stage_event_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_stage_event" ADD CONSTRAINT "deal_stage_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_goal_user_uq" ON "agent_goal" USING btree ("organization_id","user_id","metric") WHERE "agent_goal"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_goal_default_uq" ON "agent_goal" USING btree ("organization_id","metric") WHERE "agent_goal"."user_id" is null;--> statement-breakpoint
CREATE INDEX "deal_stage_event_org_idx" ON "deal_stage_event" USING btree ("organization_id","to_stage","occurred_at");--> statement-breakpoint
CREATE TRIGGER deal_stage_event_append_only
  BEFORE UPDATE OR DELETE ON "deal_stage_event"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
ALTER TABLE "agent_goal" ADD CONSTRAINT "agent_goal_target_range" CHECK ("monthly_target" BETWEEN 0 AND 10000);
--> statement-breakpoint
-- Historial inicial para operaciones creadas antes de esta migración.
INSERT INTO "deal_stage_event" ("id", "organization_id", "deal_id", "from_stage", "to_stage", "actor_user_id", "occurred_at")
SELECT gen_random_uuid(), "organization_id", "id", NULL, "stage", "created_by_id", "stage_changed_at" FROM "deal";
