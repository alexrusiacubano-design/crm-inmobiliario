CREATE TYPE "public"."deposit_holder" AS ENUM('agency', 'owner', 'notary');--> statement-breakpoint
CREATE TYPE "public"."offer_party" AS ENUM('client', 'owner');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'countered', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'converted', 'refunded', 'forfeited');--> statement-breakpoint
CREATE TABLE "deal_offer" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"previous_offer_id" uuid,
	"party" "offer_party" NOT NULL,
	"currency" "currency" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"conditions" text,
	"valid_until" date,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"response_note" text,
	"responded_at" timestamp with time zone,
	"responded_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_reservation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"currency" "currency" NOT NULL,
	"deposit_minor" bigint NOT NULL,
	"received_at" date NOT NULL,
	"expires_at" date NOT NULL,
	"holder" "deposit_holder" DEFAULT 'agency' NOT NULL,
	"receipt_number" text,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"cancel_reason" text,
	"refunded_at" date,
	"closed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_responded_by_id_user_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_offer_deal_idx" ON "deal_offer" USING btree ("deal_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_offer_org_status_idx" ON "deal_offer" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_offer_one_pending_uq" ON "deal_offer" USING btree ("deal_id") WHERE "deal_offer"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "deal_reservation_org_status_idx" ON "deal_reservation" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_reservation_one_active_uq" ON "deal_reservation" USING btree ("deal_id") WHERE "deal_reservation"."status" = 'active';--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_previous_fk" FOREIGN KEY ("previous_offer_id") REFERENCES "deal_offer"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_amount_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_response_coherent" CHECK (("status" = 'pending') = ("responded_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_deposit_positive" CHECK ("deposit_minor" > 0);
--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_dates" CHECK ("expires_at" >= "received_at");
--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_closed_coherent" CHECK (("status" = 'active') = ("closed_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_refund_coherent" CHECK ("refunded_at" IS NULL OR "status" = 'refunded');
--> statement-breakpoint
-- Lo ofrecido no se reescribe: monto, moneda y parte quedan fijos; una oferta respondida no vuelve a pendiente.
CREATE OR REPLACE FUNCTION crm_deal_offer_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_minor <> OLD.amount_minor OR NEW.currency <> OLD.currency OR NEW.party <> OLD.party
     OR NEW.deal_id <> OLD.deal_id THEN
    RAISE EXCEPTION 'deal_offer: el monto y la parte de una oferta no se modifican';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'deal_offer: una oferta respondida no cambia de estado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deal_offer_guard BEFORE UPDATE ON "deal_offer" FOR EACH ROW EXECUTE FUNCTION crm_deal_offer_guard();
--> statement-breakpoint
CREATE TRIGGER deal_offer_no_delete BEFORE DELETE ON "deal_offer" FOR EACH ROW
  WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION crm_forbid_mutation();
