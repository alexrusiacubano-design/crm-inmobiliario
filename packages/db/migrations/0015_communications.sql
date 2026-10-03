CREATE TYPE "public"."inquiry_channel" AS ENUM('web', 'portal', 'whatsapp', 'email', 'phone', 'bot', 'other');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('open', 'taken', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."template_channel" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TABLE "chat_conversation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"is_group" boolean DEFAULT false NOT NULL,
	"title" text,
	"direct_key" text,
	"last_message_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_member" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_member_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" "inquiry_channel" NOT NULL,
	"name" text,
	"phone" text,
	"email" text,
	"message" text NOT NULL,
	"property_id" uuid,
	"external_ref" text,
	"status" "inquiry_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"taken_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution_note" text,
	"contact_id" uuid,
	"lead_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "template_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversation" ADD CONSTRAINT "chat_conversation_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_member" ADD CONSTRAINT "chat_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversation_direct_uq" ON "chat_conversation" USING btree ("organization_id","direct_key") WHERE "chat_conversation"."direct_key" is not null;--> statement-breakpoint
CREATE INDEX "chat_member_user_idx" ON "chat_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_message_conversation_idx" ON "chat_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "inquiry_org_status_idx" ON "inquiry" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inquiry_org_external_uq" ON "inquiry" USING btree ("organization_id","external_ref") WHERE "inquiry"."external_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_org_name_uq" ON "message_template" USING btree ("organization_id","channel","name");--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_contact_info" CHECK ("phone" IS NOT NULL OR "email" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_taken_coherent" CHECK ("status" = 'open' OR "assigned_user_id" IS NOT NULL OR "status" = 'rejected');
--> statement-breakpoint
ALTER TABLE "inquiry" ADD CONSTRAINT "inquiry_closed_coherent" CHECK (("status" IN ('resolved', 'rejected')) = ("closed_at" IS NOT NULL));
--> statement-breakpoint
CREATE TRIGGER chat_message_append_only
  BEFORE UPDATE OR DELETE ON "chat_message"
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION crm_forbid_mutation();
--> statement-breakpoint
-- Recepción atiende la bandeja de consultas: se agregan los permisos al rol de sistema existente.
INSERT INTO "role_permission" ("role_id", "permission_code", "scope")
SELECT r."id", p.code, 'org'
FROM "role" r
CROSS JOIN (VALUES ('communication.send'), ('lead.assign')) AS p(code)
WHERE r."key" = 'reception' AND r."is_system" = true
ON CONFLICT DO NOTHING;
