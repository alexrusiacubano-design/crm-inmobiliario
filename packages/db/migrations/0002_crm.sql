CREATE TYPE "public"."activity_type" AS ENUM('note', 'call', 'whatsapp', 'email', 'meeting', 'contact_created', 'contact_updated', 'contact_merged', 'lead_created', 'lead_status_changed', 'lead_assigned', 'search_updated', 'owner_updated', 'property_sent', 'visit', 'offer', 'document', 'task');--> statement-breakpoint
CREATE TYPE "public"."channel_type" AS ENUM('phone', 'whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."contact_kind" AS ENUM('person', 'company');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('ci', 'passport', 'rut', 'dni', 'other');--> statement-breakpoint
CREATE TYPE "public"."duplicate_status" AS ENUM('pending', 'merged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."lead_lost_reason" AS ENUM('no_response', 'price', 'bought_elsewhere', 'no_longer_interested', 'financing', 'no_match', 'duplicate', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_operation" AS ENUM('buy', 'rent', 'temporary_rent');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('portal', 'website', 'whatsapp', 'phone', 'walk_in', 'referral', 'social', 'sign', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'contacted', 'qualified', 'visit', 'offer', 'reservation', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid,
	"lead_id" uuid,
	"type" "activity_type" NOT NULL,
	"direction" text,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "contact_kind" DEFAULT 'person' NOT NULL,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"display_name" text NOT NULL,
	"document_type" "document_type",
	"document_number" text,
	"nationality" text,
	"address" text,
	"department_id" integer,
	"locality_id" integer,
	"notes" text,
	"assigned_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"merged_into_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_channel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"type" "channel_type" NOT NULL,
	"value" text NOT NULL,
	"normalized" text NOT NULL,
	"label" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_tag" (
	"contact_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "contact_tag_contact_id_tag_id_pk" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "duplicate_candidate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_a_id" uuid NOT NULL,
	"contact_b_id" uuid NOT NULL,
	"reasons" text[] NOT NULL,
	"score" integer NOT NULL,
	"status" "duplicate_status" DEFAULT 'pending' NOT NULL,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"source" "lead_source" NOT NULL,
	"operation" "lead_operation" NOT NULL,
	"assigned_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"notes" text,
	"lost_reason" "lead_lost_reason",
	"first_contacted_at" timestamp with time zone,
	"last_contact_at" timestamp with time zone,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "owner_profile" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_name" text,
	"account_holder" text,
	"account_number_encrypted" text,
	"account_number_last4" text,
	"account_currency" "currency",
	"authorization_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_document" (
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"body" text NOT NULL,
	"owner_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_document_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "search_profile" (
	"lead_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"operation" "lead_operation" NOT NULL,
	"property_types" text[] DEFAULT '{}' NOT NULL,
	"department_ids" integer[] DEFAULT '{}' NOT NULL,
	"locality_ids" integer[] DEFAULT '{}' NOT NULL,
	"neighborhood_ids" integer[] DEFAULT '{}' NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"price_min_minor" bigint,
	"price_max_minor" bigint,
	"bedrooms_min" integer,
	"bathrooms_min" integer,
	"garages_min" integer,
	"area_min" integer,
	"common_expenses_max_minor" bigint,
	"common_expenses_currency" "currency" DEFAULT 'UYU' NOT NULL,
	"pets" boolean DEFAULT false NOT NULL,
	"furnished" text DEFAULT 'any' NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"target_date" date,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_channel" ADD CONSTRAINT "contact_channel_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tag" ADD CONSTRAINT "contact_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_contact_a_id_contact_id_fk" FOREIGN KEY ("contact_a_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_contact_b_id_contact_id_fk" FOREIGN KEY ("contact_b_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_candidate" ADD CONSTRAINT "duplicate_candidate_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_profile" ADD CONSTRAINT "owner_profile_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_profile" ADD CONSTRAINT "owner_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_document" ADD CONSTRAINT "search_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profile" ADD CONSTRAINT "search_profile_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_profile" ADD CONSTRAINT "search_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_contact_idx" ON "activity" USING btree ("organization_id","contact_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_lead_idx" ON "activity" USING btree ("organization_id","lead_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "contact_org_name_idx" ON "contact" USING btree ("organization_id","display_name");--> statement-breakpoint
CREATE INDEX "contact_org_assigned_idx" ON "contact" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "contact_org_branch_idx" ON "contact" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_org_document_uq" ON "contact" USING btree ("organization_id","document_type","document_number") WHERE "contact"."deleted_at" is null and "contact"."document_number" is not null;--> statement-breakpoint
CREATE INDEX "contact_channel_contact_idx" ON "contact_channel" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_channel_lookup_idx" ON "contact_channel" USING btree ("organization_id","normalized");--> statement-breakpoint
CREATE INDEX "contact_tag_tag_idx" ON "contact_tag" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_pair_uq" ON "duplicate_candidate" USING btree ("organization_id","contact_a_id","contact_b_id");--> statement-breakpoint
CREATE INDEX "duplicate_org_status_idx" ON "duplicate_candidate" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_org_code_uq" ON "lead" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "lead_org_status_idx" ON "lead" USING btree ("organization_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lead_org_assigned_idx" ON "lead" USING btree ("organization_id","assigned_user_id","status");--> statement-breakpoint
CREATE INDEX "lead_contact_idx" ON "lead" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "search_document_org_idx" ON "search_document" USING btree ("organization_id","entity_type");--> statement-breakpoint
CREATE INDEX "search_document_body_trgm" ON "search_document" USING gin ("body" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "tag_org_name_uq" ON "tag" USING btree ("organization_id","name");