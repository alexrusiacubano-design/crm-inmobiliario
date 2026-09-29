CREATE TYPE "public"."adjustment_index" AS ENUM('ipc', 'ui', 'fixed', 'none');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('active', 'ended', 'terminated', 'renewed');--> statement-breakpoint
CREATE TYPE "public"."rent_change_reason" AS ENUM('initial', 'adjustment', 'renewal', 'agreement');--> statement-breakpoint
CREATE TABLE "rental_contract" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"property_id" uuid NOT NULL,
	"tenant_contact_id" uuid NOT NULL,
	"deal_id" uuid,
	"renewed_from_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"currency" "currency" NOT NULL,
	"rent_minor" bigint NOT NULL,
	"payment_day" integer DEFAULT 10 NOT NULL,
	"adjustment_index" "adjustment_index" DEFAULT 'ipc' NOT NULL,
	"adjustment_months" integer DEFAULT 12 NOT NULL,
	"fixed_adjustment_basis_points" integer,
	"next_adjustment_at" date,
	"deposit_minor" bigint,
	"deposit_currency" "currency",
	"admin_fee_basis_points" integer,
	"guarantee_note" text,
	"status" "contract_status" DEFAULT 'active' NOT NULL,
	"closed_at" date,
	"close_reason" text,
	"notes" text,
	"assigned_user_id" uuid NOT NULL,
	"branch_id" uuid,
	"team_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rental_contract_rent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reason" "rent_change_reason" NOT NULL,
	"basis_points" integer,
	"note" text,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_tenant_contact_id_contact_id_fk" FOREIGN KEY ("tenant_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_renewed_from_id_rental_contract_id_fk" FOREIGN KEY ("renewed_from_id") REFERENCES "public"."rental_contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract_rent" ADD CONSTRAINT "rental_contract_rent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract_rent" ADD CONSTRAINT "rental_contract_rent_contract_id_rental_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."rental_contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_contract_rent" ADD CONSTRAINT "rental_contract_rent_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rental_contract_org_code_uq" ON "rental_contract" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_contract_one_active_uq" ON "rental_contract" USING btree ("property_id") WHERE "rental_contract"."status" = 'active' and "rental_contract"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "rental_contract_org_status_idx" ON "rental_contract" USING btree ("organization_id","status","end_date");--> statement-breakpoint
CREATE INDEX "rental_contract_tenant_idx" ON "rental_contract" USING btree ("tenant_contact_id");--> statement-breakpoint
CREATE INDEX "rental_contract_rent_contract_idx" ON "rental_contract_rent" USING btree ("contract_id","effective_from");--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_dates" CHECK ("end_date" > "start_date");
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_rent_positive" CHECK ("rent_minor" > 0);
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_payment_day" CHECK ("payment_day" BETWEEN 1 AND 28);
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_adjustment_months" CHECK ("adjustment_months" BETWEEN 1 AND 60);
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_admin_fee" CHECK ("admin_fee_basis_points" IS NULL OR "admin_fee_basis_points" BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_deposit" CHECK (("deposit_minor" IS NULL) = ("deposit_currency" IS NULL) AND ("deposit_minor" IS NULL OR "deposit_minor" > 0));
--> statement-breakpoint
ALTER TABLE "rental_contract" ADD CONSTRAINT "rental_contract_closed_coherent" CHECK (("status" = 'active') = ("closed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "rental_contract_rent" ADD CONSTRAINT "rental_contract_rent_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
CREATE TRIGGER rental_contract_rent_append_only
  BEFORE UPDATE OR DELETE ON "rental_contract_rent"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
