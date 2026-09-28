-- Garantías a nivel de base de datos que no dependen del código de la aplicación.

-- 1) Unicidad de asignación de rol, tratando branch_id NULL como un valor (rol en toda la org).
CREATE UNIQUE INDEX IF NOT EXISTS "membership_role_uq"
  ON "membership_role" ("membership_id", "role_id", "branch_id") NULLS NOT DISTINCT;
--> statement-breakpoint

-- 2) Auditoría append-only: no se permite modificar ni borrar registros.
CREATE OR REPLACE FUNCTION crm_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción (append-only): % no permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint

-- 3) Outbox: el evento es inmutable; solo cambian las columnas de entrega.
CREATE OR REPLACE FUNCTION crm_domain_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'domain_event no admite DELETE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.aggregate_type IS DISTINCT FROM OLD.aggregate_type
     OR NEW.aggregate_id IS DISTINCT FROM OLD.aggregate_id
     OR NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'domain_event: solo se pueden actualizar processed_at, attempts y last_error'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER domain_event_guard
  BEFORE UPDATE OR DELETE ON "domain_event"
  FOR EACH ROW EXECUTE FUNCTION crm_domain_event_guard();
--> statement-breakpoint

-- 4) Búsqueda sin acentos (se usa desde la Fase 2 para la búsqueda global).
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
