CREATE TYPE "public"."deposit_place" AS ENUM('bhu', 'agency', 'owner', 'other');--> statement-breakpoint
CREATE TYPE "public"."guarantee_status" AS ENUM('in_process', 'approved', 'rejected', 'active', 'expired', 'released');--> statement-breakpoint
CREATE TYPE "public"."guarantee_type" AS ENUM('anda', 'cgn', 'mvot', 'insurance', 'deposit', 'property_guarantor', 'other');--> statement-breakpoint
CREATE TABLE "rental_guarantee" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"tenant_contact_id" uuid NOT NULL,
	"contract_id" uuid,
	"deal_id" uuid,
	"type" "guarantee_type" NOT NULL,
	"status" "guarantee_status" DEFAULT 'in_process' NOT NULL,
	"provider" text,
	"reference" text,
	"currency" "currency" DEFAULT 'UYU' NOT NULL,
	"coverage_minor" bigint,
	"requested_at" date NOT NULL,
	"valid_from" date,
	"valid_until" date,
	"deposit_place" "deposit_place",
	"guarantor_contact_id" uuid,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"status_note" text,
	"assigned_user_id" uuid NOT NULL,
	"branch_id" uuid,
	"team_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_tenant_contact_id_contact_id_fk" FOREIGN KEY ("tenant_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_contract_id_rental_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."rental_contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_guarantor_contact_id_contact_id_fk" FOREIGN KEY ("guarantor_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_guarantee_org_status_idx" ON "rental_guarantee" USING btree ("organization_id","status","valid_until");--> statement-breakpoint
CREATE INDEX "rental_guarantee_contract_idx" ON "rental_guarantee" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "rental_guarantee_tenant_idx" ON "rental_guarantee" USING btree ("tenant_contact_id");--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_coverage_positive" CHECK ("coverage_minor" IS NULL OR "coverage_minor" > 0);
--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_dates" CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" >= "valid_from");
--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_active_needs_contract" CHECK ("status" NOT IN ('active', 'expired') OR "contract_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "rental_guarantee" ADD CONSTRAINT "rental_guarantee_guarantor_type" CHECK ("guarantor_contact_id" IS NULL OR "type" IN ('property_guarantor', 'other'));
