ALTER TABLE "deal_reservation" ADD COLUMN "signing_date" date;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "boleto_signed_at" date;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "boleto_expires_at" date;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "shared_with" text;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "buyer_notary" jsonb;--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD COLUMN "seller_notary" jsonb;--> statement-breakpoint
-- La reserva puede registrarse sin seña (monto 0).
ALTER TABLE "deal_reservation" DROP CONSTRAINT IF EXISTS "deal_reservation_deposit_positive";--> statement-breakpoint
ALTER TABLE "deal_reservation" ADD CONSTRAINT "deal_reservation_deposit_nonnegative" CHECK ("deposit_minor" >= 0);
