CREATE TYPE "public"."invoice_kind" AS ENUM('e_factura', 'e_ticket');--> statement-breakpoint
CREATE TYPE "public"."invoice_source_type" AS ENUM('deal_commission', 'settlement_fee');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'voided');--> statement-breakpoint
CREATE TYPE "public"."receiver_doc_type" AS ENUM('rut', 'ci', 'other');--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"contact_id" uuid,
	"receiver_name" text NOT NULL,
	"receiver_doc_type" "receiver_doc_type" NOT NULL,
	"receiver_doc" text,
	"receiver_address" text,
	"currency" "currency" NOT NULL,
	"tax_included" boolean DEFAULT false NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"cfe_series" text,
	"cfe_number" integer,
	"issued_at" date,
	"issued_by_id" uuid,
	"void_reason" text,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"net_minor" bigint NOT NULL,
	"tax_rate_bp" integer NOT NULL,
	"tax_minor" bigint NOT NULL,
	"source_type" "invoice_source_type",
	"source_id" uuid,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_issued_by_id_user_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_code_uq" ON "invoice" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_org_cfe_uq" ON "invoice" USING btree ("organization_id","kind","cfe_series","cfe_number") WHERE "invoice"."cfe_number" is not null;--> statement-breakpoint
CREATE INDEX "invoice_org_status_idx" ON "invoice" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoice_line_invoice_idx" ON "invoice_line" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_line_source_active_uq" ON "invoice_line" USING btree ("source_type","source_id") WHERE "invoice_line"."source_id" is not null and "invoice_line"."active";--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_total_check" CHECK ("total_minor" = "subtotal_minor" + "tax_minor");--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_issued_check" CHECK ("status" = 'draft' OR ("cfe_series" IS NOT NULL AND "cfe_number" IS NOT NULL AND "issued_at" IS NOT NULL));--> statement-breakpoint
-- Una factura emitida no cambia: solo puede pasar a anulada (con motivo).
CREATE OR REPLACE FUNCTION crm_invoice_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'Una factura anulada no se modifica';
  END IF;
  IF OLD.status = 'issued' AND (NEW.status <> 'voided' OR NEW.total_minor <> OLD.total_minor
      OR NEW.receiver_name <> OLD.receiver_name OR NEW.cfe_number IS DISTINCT FROM OLD.cfe_number) THEN
    RAISE EXCEPTION 'Una factura emitida no se modifica: anulala';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER invoice_guard BEFORE UPDATE ON "invoice" FOR EACH ROW EXECUTE FUNCTION crm_invoice_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_invoice_delete_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Solo se borran borradores';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER invoice_delete_guard BEFORE DELETE ON "invoice" FOR EACH ROW EXECUTE FUNCTION crm_invoice_delete_guard();
