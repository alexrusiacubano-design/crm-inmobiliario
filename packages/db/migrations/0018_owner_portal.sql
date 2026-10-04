CREATE TYPE "public"."portal_access_status" AS ENUM('invited', 'active', 'revoked');--> statement-breakpoint
CREATE TABLE "owner_portal_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid,
	"status" "portal_access_status" DEFAULT 'invited' NOT NULL,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by_id" uuid,
	"activated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_portal_access_org_contact_uq" ON "owner_portal_access" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_portal_access_user_uq" ON "owner_portal_access" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_portal_access_token_uq" ON "owner_portal_access" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "owner_portal_access_org_idx" ON "owner_portal_access" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "owner_portal_access" ADD CONSTRAINT "owner_portal_access_active_user_check" CHECK ("status" <> 'active' OR "user_id" IS NOT NULL);--> statement-breakpoint
-- Defensa en profundidad (Supabase): RLS activado en todas las tablas del esquema público y sin
-- políticas para los roles de la API (anon / authenticated), así la API REST de Supabase no
-- expone ningún dato aunque alguien obtenga la clave pública. La aplicación se conecta con el
-- rol dueño de las tablas, que no está sujeto a RLS, y aplica los permisos en el servidor.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
  END IF;
END $$;
