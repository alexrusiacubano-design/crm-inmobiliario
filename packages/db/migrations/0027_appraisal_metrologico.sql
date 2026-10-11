ALTER TABLE "appraisal" ALTER COLUMN "offer_discount_bp" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "appraisal" ADD COLUMN "subject_construction" numeric(4, 1);--> statement-breakpoint
ALTER TABLE "appraisal" ADD COLUMN "subject_location" numeric(4, 1);--> statement-breakpoint
-- Tasaciones anteriores: el bien queda en 3 (los antecedentes se convierten al leerlos).
UPDATE "appraisal" SET "subject_construction" = 3, "subject_location" = 3 WHERE "subject_construction" IS NULL;
