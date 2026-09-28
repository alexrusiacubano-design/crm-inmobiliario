CREATE TYPE "public"."acquisition_stage" AS ENUM('prospect', 'contacted', 'valuation', 'negotiation', 'authorization', 'captured', 'published', 'lost');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('property', 'owner', 'client', 'deal', 'contract', 'guarantee', 'finance');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('valid', 'pending', 'expired', 'archived');--> statement-breakpoint
CREATE TYPE "public"."document_visibility" AS ENUM('internal', 'restricted', 'confidential');--> statement-breakpoint
CREATE TYPE "public"."expense_kind" AS ENUM('common_expenses', 'property_tax', 'primary_tax', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_period" AS ENUM('monthly', 'bimonthly', 'annual', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('photo', 'floor_plan', 'video');--> statement-breakpoint
CREATE TYPE "public"."orientation" AS ENUM('north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest');--> statement-breakpoint
CREATE TYPE "public"."price_field" AS ENUM('list', 'owner_asking', 'minimum');--> statement-breakpoint
CREATE TYPE "public"."property_condition" AS ENUM('new', 'excellent', 'very_good', 'good', 'to_renovate', 'under_construction');--> statement-breakpoint
CREATE TYPE "public"."property_operation" AS ENUM('sale', 'rent', 'temporary_rent');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('draft', 'available', 'published', 'negotiating', 'reserved', 'rented', 'sold', 'paused', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('apartment', 'house', 'ph', 'land', 'office', 'commercial', 'warehouse', 'farm', 'garage');--> statement-breakpoint
CREATE TYPE "public"."valuation_method" AS ENUM('comparables', 'cost', 'income', 'mixed');--> statement-breakpoint
CREATE TABLE "acquisition" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"stage" "acquisition_stage" DEFAULT 'prospect' NOT NULL,
	"owner_contact_id" uuid NOT NULL,
	"property_id" uuid,
	"property_type" "property_type" NOT NULL,
	"operation" "property_operation" NOT NULL,
	"address" text,
	"locality_id" integer,
	"neighborhood_id" integer,
	"captador_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"exclusive" boolean DEFAULT false NOT NULL,
	"exclusive_from" date,
	"exclusive_until" date,
	"commission_basis_points" integer,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"asking_minor" bigint,
	"recommended_minor" bigint,
	"publication_authorized" boolean DEFAULT false NOT NULL,
	"lost_reason" text,
	"notes" text,
	"stage_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" "document_category" NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"expires_at" date,
	"visibility" "document_visibility" DEFAULT 'internal' NOT NULL,
	"status" "document_status" DEFAULT 'valid' NOT NULL,
	"responsible_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "document_link" (
	"document_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "document_link_document_id_entity_type_entity_id_pk" PRIMARY KEY("document_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"type" "property_type" NOT NULL,
	"operations" "property_operation"[] NOT NULL,
	"status" "property_status" DEFAULT 'draft' NOT NULL,
	"title" text,
	"description" text,
	"department_id" integer,
	"locality_id" integer,
	"neighborhood_id" integer,
	"address" text,
	"unit" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"bedrooms" integer,
	"bathrooms" integer,
	"suites" integer,
	"garages" integer,
	"total_area" numeric(12, 2),
	"built_area" numeric(10, 2),
	"floor" text,
	"year_built" integer,
	"orientation" "orientation",
	"condition" "property_condition",
	"features" text[] DEFAULT '{}' NOT NULL,
	"pets_allowed" boolean DEFAULT false NOT NULL,
	"furnished" boolean DEFAULT false NOT NULL,
	"commission_basis_points" integer,
	"internal_notes" text,
	"assigned_user_id" uuid,
	"captador_user_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "property_expense" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "expense_kind" NOT NULL,
	"label" text,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"period" "expense_period" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" "media_kind" NOT NULL,
	"storage_key" text,
	"thumb_key" text,
	"url" text,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"caption" text,
	"position" integer NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_owner" (
	"property_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"share_basis_points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_owner_property_id_contact_id_pk" PRIMARY KEY("property_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "property_price" (
	"property_id" uuid NOT NULL,
	"operation" "property_operation" NOT NULL,
	"currency" "currency" NOT NULL,
	"list_minor" bigint,
	"owner_asking_minor" bigint,
	"minimum_minor" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_price_property_id_operation_pk" PRIMARY KEY("property_id","operation")
);
--> statement-breakpoint
CREATE TABLE "property_price_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"operation" "property_operation" NOT NULL,
	"field" "price_field" NOT NULL,
	"currency" "currency" NOT NULL,
	"old_minor" bigint,
	"new_minor" bigint,
	"reason" text,
	"changed_by_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "valuation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"property_id" uuid,
	"acquisition_id" uuid,
	"method" "valuation_method" NOT NULL,
	"currency" "currency" NOT NULL,
	"value_minor" bigint NOT NULL,
	"min_minor" bigint,
	"max_minor" bigint,
	"valued_at" date NOT NULL,
	"comparables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"valued_by_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_owner_contact_id_contact_id_fk" FOREIGN KEY ("owner_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_locality_id_locality_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."locality"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_neighborhood_id_neighborhood_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhood"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_captador_user_id_user_id_fk" FOREIGN KEY ("captador_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition" ADD CONSTRAINT "acquisition_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_responsible_user_id_user_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_locality_id_locality_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."locality"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_neighborhood_id_neighborhood_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhood"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_assigned_user_id_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_captador_user_id_user_id_fk" FOREIGN KEY ("captador_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_expense" ADD CONSTRAINT "property_expense_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_media" ADD CONSTRAINT "property_media_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_owner" ADD CONSTRAINT "property_owner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price" ADD CONSTRAINT "property_price_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_price_history" ADD CONSTRAINT "property_price_history_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_acquisition_id_acquisition_id_fk" FOREIGN KEY ("acquisition_id") REFERENCES "public"."acquisition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_valued_by_id_user_id_fk" FOREIGN KEY ("valued_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation" ADD CONSTRAINT "valuation_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_org_code_uq" ON "acquisition" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "acquisition_org_stage_idx" ON "acquisition" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "acquisition_org_captador_idx" ON "acquisition" USING btree ("organization_id","captador_user_id");--> statement-breakpoint
CREATE INDEX "acquisition_property_idx" ON "acquisition" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "acquisition_exclusive_idx" ON "acquisition" USING btree ("organization_id","exclusive_until") WHERE "acquisition"."exclusive";--> statement-breakpoint
CREATE INDEX "document_org_category_idx" ON "document" USING btree ("organization_id","category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "document_org_expires_idx" ON "document" USING btree ("organization_id","expires_at") WHERE "document"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "document_link_entity_idx" ON "document_link" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_org_code_uq" ON "property" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "property_org_status_idx" ON "property" USING btree ("organization_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "property_org_assigned_idx" ON "property" USING btree ("organization_id","assigned_user_id");--> statement-breakpoint
CREATE INDEX "property_org_location_idx" ON "property" USING btree ("organization_id","locality_id","neighborhood_id");--> statement-breakpoint
CREATE INDEX "property_operations_gin" ON "property" USING gin ("operations");--> statement-breakpoint
CREATE INDEX "property_expense_property_idx" ON "property_expense" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_media_order_idx" ON "property_media" USING btree ("property_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "property_media_cover_uq" ON "property_media" USING btree ("property_id") WHERE "property_media"."is_cover";--> statement-breakpoint
CREATE INDEX "property_owner_contact_idx" ON "property_owner" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "property_price_list_idx" ON "property_price" USING btree ("operation","currency","list_minor");--> statement-breakpoint
CREATE INDEX "price_history_property_idx" ON "property_price_history" USING btree ("property_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "valuation_property_idx" ON "valuation" USING btree ("property_id","valued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "valuation_acquisition_idx" ON "valuation" USING btree ("acquisition_id");--> statement-breakpoint
CREATE INDEX "valuation_org_idx" ON "valuation" USING btree ("organization_id","valued_at" DESC NULLS LAST);