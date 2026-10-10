ALTER TABLE "property" ADD COLUMN "exclusive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "exclusive_until" date;--> statement-breakpoint
-- La exclusividad pactada en la captación pasa a la propiedad.
UPDATE "property" AS p SET "exclusive" = true, "exclusive_until" = a."exclusive_until" FROM "acquisition" AS a WHERE a."property_id" = p."id" AND a."exclusive" AND a."deleted_at" IS NULL;
