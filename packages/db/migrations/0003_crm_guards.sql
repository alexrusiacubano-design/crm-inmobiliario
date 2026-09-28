-- Timeline append-only: solo se permite reasignar contact_id (fusión de duplicados).
CREATE OR REPLACE FUNCTION crm_activity_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'activity es de solo inserción (append-only): DELETE no permitido'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.direction IS DISTINCT FROM OLD.direction
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'activity es de solo inserción (append-only): solo puede cambiar contact_id al fusionar'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER activity_append_only
  BEFORE UPDATE OR DELETE ON "activity"
  FOR EACH ROW EXECUTE FUNCTION crm_activity_guard();
--> statement-breakpoint

-- Un par de duplicados siempre se guarda ordenado (a < b).
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_pair_ordered" CHECK ("contact_a_id" < "contact_b_id");
--> statement-breakpoint

-- Los montos de búsqueda nunca son negativos.
ALTER TABLE "search_profile" ADD CONSTRAINT "search_profile_amounts_non_negative"
  CHECK (coalesce("price_min_minor", 0) >= 0 AND coalesce("price_max_minor", 0) >= 0 AND coalesce("common_expenses_max_minor", 0) >= 0);
