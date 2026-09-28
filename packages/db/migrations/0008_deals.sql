CREATE TYPE "public"."commission_side" AS ENUM('buyer', 'seller', 'tenant', 'landlord');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('pending', 'collected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deal_stage" AS ENUM('negotiation', 'reserved', 'notary', 'signed', 'closed', 'fallen');--> statement-breakpoint
CREATE TYPE "public"."participant_role" AS ENUM('lister', 'seller_agent', 'collaborator', 'referrer');--> statement-breakpoint
CREATE TABLE "commission_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"uyu_per_usd" numeric(10, 4) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_tier" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"min_billed_usd_minor" bigint NOT NULL,
	"rate_basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"operation" "property_operation" NOT NULL,
	"stage" "deal_stage" DEFAULT 'negotiation' NOT NULL,
	"property_id" uuid NOT NULL,
	"client_contact_id" uuid NOT NULL,
	"lead_id" uuid,
	"currency" "currency" NOT NULL,
	"price_minor" bigint NOT NULL,
	"expected_close_date" date,
	"closed_at" date,
	"fallen_reason" text,
	"notes" text,
	"assigned_user_id" uuid NOT NULL,
	"branch_id" uuid,
	"team_id" uuid,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deal_commission" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"side" "commission_side" NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL,
	"due_date" date,
	"collected_at" date,
	"reference" text,
	"collected_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_participant" (
	"deal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "participant_role" NOT NULL,
	"share_basis_points" integer NOT NULL,
	"agent_rate_basis_points" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_participant_deal_id_user_id_pk" PRIMARY KEY("deal_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_tier" ADD CONSTRAINT "commission_tier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_client_contact_id_contact_id_fk" FOREIGN KEY ("client_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_commission" ADD CONSTRAINT "deal_commission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_commission" ADD CONSTRAINT "deal_commission_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_commission" ADD CONSTRAINT "deal_commission_collected_by_id_user_id_fk" FOREIGN KEY ("collected_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_participant" ADD CONSTRAINT "deal_participant_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_participant" ADD CONSTRAINT "deal_participant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_participant" ADD CONSTRAINT "deal_participant_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_tier_org_pos_uq" ON "commission_tier" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_org_code_uq" ON "deal" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "deal_org_stage_idx" ON "deal" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "deal_org_assigned_idx" ON "deal" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "deal_property_idx" ON "deal" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_commission_side_uq" ON "deal_commission" USING btree ("deal_id","side");--> statement-breakpoint
CREATE INDEX "deal_commission_org_status_idx" ON "deal_commission" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "deal_participant_user_idx" ON "deal_participant" USING btree ("organization_id","user_id");--> statement-breakpoint
-- Invariantes de operaciones y comisiones.
ALTER TABLE "deal" ADD CONSTRAINT "deal_price_positive" CHECK ("price_minor" > 0);
--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_closed_has_date" CHECK (("stage" = 'closed') = ("closed_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "deal_commission" ADD CONSTRAINT "deal_commission_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "deal_commission" ADD CONSTRAINT "deal_commission_collected_date"
  CHECK (("status" = 'collected') = ("collected_at" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "deal_participant" ADD CONSTRAINT "deal_participant_share_range"
  CHECK ("share_basis_points" > 0 AND "share_basis_points" <= 10000);
--> statement-breakpoint
ALTER TABLE "deal_participant" ADD CONSTRAINT "deal_participant_rate_range"
  CHECK ("agent_rate_basis_points" IS NULL OR "agent_rate_basis_points" BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE "commission_tier" ADD CONSTRAINT "commission_tier_rate_range" CHECK ("rate_basis_points" BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE "commission_settings" ADD CONSTRAINT "commission_settings_rate_positive" CHECK ("uyu_per_usd" > 0);
