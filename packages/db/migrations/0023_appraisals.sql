CREATE TABLE "appraisal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"address" text,
	"property_type" "property_type" NOT NULL,
	"operation" "property_operation" DEFAULT 'sale' NOT NULL,
	"department_id" integer,
	"locality_id" integer,
	"neighborhood_id" integer,
	"built_area" numeric(10, 2),
	"total_area" numeric(12, 2),
	"bedrooms" integer,
	"bathrooms" integer,
	"garages" integer,
	"year_built" integer,
	"condition" "property_condition",
	"client_name" text,
	"client_contact_id" uuid,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"offer_discount_bp" integer DEFAULT 700 NOT NULL,
	"comparables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unit_value_minor" bigint,
	"estimated_minor" bigint,
	"min_minor" bigint,
	"max_minor" bigint,
	"adopted_minor" bigint,
	"notes" text,
	"valued_at" date NOT NULL,
	"property_id" uuid,
	"acquisition_id" uuid,
	"valuation_id" uuid,
	"valued_by_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "appraisal_status_check" CHECK ("appraisal"."status" in ('draft', 'final'))
);
--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_locality_id_locality_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."locality"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_neighborhood_id_neighborhood_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhood"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_client_contact_id_contact_id_fk" FOREIGN KEY ("client_contact_id") REFERENCES "public"."contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_acquisition_id_acquisition_id_fk" FOREIGN KEY ("acquisition_id") REFERENCES "public"."acquisition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_valuation_id_valuation_id_fk" FOREIGN KEY ("valuation_id") REFERENCES "public"."valuation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_valued_by_id_user_id_fk" FOREIGN KEY ("valued_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appraisal" ADD CONSTRAINT "appraisal_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appraisal_org_code_idx" ON "appraisal" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "appraisal_org_date_idx" ON "appraisal" USING btree ("organization_id","valued_at" DESC NULLS LAST);