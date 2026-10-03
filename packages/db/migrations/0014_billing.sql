CREATE TYPE "public"."charge_line_kind" AS ENUM('rent', 'common_expenses', 'property_tax', 'late_fee', 'discount', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('transfer', 'cash', 'deposit', 'check', 'other');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('draft', 'approved', 'paid', 'voided');--> statement-breakpoint
CREATE TABLE "owner_settlement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"contract_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"income_minor" bigint NOT NULL,
	"fee_minor" bigint NOT NULL,
	"deductions_minor" bigint NOT NULL,
	"net_minor" bigint NOT NULL,
	"deductions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shares" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "settlement_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"paid_at" date,
	"reference" text,
	"void_reason" text,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_charge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" "currency" NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_charge_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"kind" charge_line_kind NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rent_payment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"charge_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"paid_at" date NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"voids_payment_id" uuid,
	"void_reason" text,
	"received_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_contract_id_rental_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."rental_contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_charge_id_rent_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."rent_charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_contract_id_rental_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."rental_contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge_line" ADD CONSTRAINT "rent_charge_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge_line" ADD CONSTRAINT "rent_charge_line_charge_id_rent_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."rent_charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_charge_line" ADD CONSTRAINT "rent_charge_line_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_charge_id_rent_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."rent_charge"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_voids_payment_id_rent_payment_id_fk" FOREIGN KEY ("voids_payment_id") REFERENCES "public"."rent_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_received_by_id_user_id_fk" FOREIGN KEY ("received_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_settlement_org_code_uq" ON "owner_settlement" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_settlement_one_per_charge_uq" ON "owner_settlement" USING btree ("charge_id") WHERE "owner_settlement"."status" <> 'voided';--> statement-breakpoint
CREATE INDEX "owner_settlement_org_status_idx" ON "owner_settlement" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_charge_contract_period_uq" ON "rent_charge" USING btree ("contract_id","period");--> statement-breakpoint
CREATE INDEX "rent_charge_org_period_idx" ON "rent_charge" USING btree ("organization_id","period");--> statement-breakpoint
CREATE INDEX "rent_charge_line_charge_idx" ON "rent_charge_line" USING btree ("charge_id");--> statement-breakpoint
CREATE INDEX "rent_payment_charge_idx" ON "rent_payment" USING btree ("charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rent_payment_void_once_uq" ON "rent_payment" USING btree ("voids_payment_id") WHERE "rent_payment"."voids_payment_id" is not null;--> statement-breakpoint
ALTER TABLE "rent_charge" ADD CONSTRAINT "rent_charge_period_first_day" CHECK (extract(day from "period") = 1);
--> statement-breakpoint
ALTER TABLE "rent_charge_line" ADD CONSTRAINT "rent_charge_line_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "rent_payment" ADD CONSTRAINT "rent_payment_sign" CHECK (("voids_payment_id" IS NULL AND "amount_minor" > 0) OR ("voids_payment_id" IS NOT NULL AND "amount_minor" < 0 AND "void_reason" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_math" CHECK ("net_minor" = "income_minor" - "fee_minor" - "deductions_minor" AND "fee_minor" >= 0 AND "deductions_minor" >= 0 AND "income_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "owner_settlement" ADD CONSTRAINT "owner_settlement_paid_coherent" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL));
--> statement-breakpoint
CREATE TRIGGER rent_payment_append_only
  BEFORE UPDATE OR DELETE ON "rent_payment"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rent_charge_line_append_only
  BEFORE UPDATE OR DELETE ON "rent_charge_line"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
