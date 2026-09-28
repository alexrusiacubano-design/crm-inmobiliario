-- Historial de precios y tasaciones: append-only (reusa la función de 0001).
CREATE TRIGGER property_price_history_append_only
  BEFORE UPDATE OR DELETE ON "property_price_history"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER valuation_append_only
  BEFORE UPDATE OR DELETE ON "valuation"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint

-- Invariantes de datos que no dependen del código.
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_share_range"
  CHECK ("share_basis_points" > 0 AND "share_basis_points" <= 10000);
--> statement-breakpoint
ALTER TABLE "property_price" ADD CONSTRAINT "property_price_non_negative"
  CHECK (coalesce("list_minor", 0) >= 0 AND coalesce("owner_asking_minor", 0) >= 0 AND coalesce("minimum_minor", 0) >= 0);
--> statement-breakpoint
ALTER TABLE "property_expense" ADD CONSTRAINT "property_expense_non_negative" CHECK ("amount_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_operations_not_empty" CHECK (cardinality("operations") > 0);
--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_commission_range"
  CHECK ("commission_basis_points" IS NULL OR "commission_basis_points" BETWEEN 0 AND 10000);
--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_exclusive_dates"
  CHECK (NOT "exclusive" OR ("exclusive_from" IS NOT NULL AND "exclusive_until" IS NOT NULL AND "exclusive_until" >= "exclusive_from"));
--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_target"
  CHECK ("property_id" IS NOT NULL OR "acquisition_id" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_source"
  CHECK (("kind" = 'video' AND "url" IS NOT NULL) OR ("kind" <> 'video' AND "storage_key" IS NOT NULL));
