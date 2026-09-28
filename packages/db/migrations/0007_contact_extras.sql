CREATE TYPE "public"."relation_type" AS ENUM('spouse', 'family', 'partner', 'lawyer', 'notary', 'guarantor', 'referrer', 'other');--> statement-breakpoint
CREATE TABLE "contact_date" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"label" text NOT NULL,
	"date" date NOT NULL,
	"yearly" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_relation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"related_contact_id" uuid NOT NULL,
	"type" "relation_type" NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_date" ADD CONSTRAINT "contact_date_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_date" ADD CONSTRAINT "contact_date_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_date" ADD CONSTRAINT "contact_date_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relation" ADD CONSTRAINT "contact_relation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relation" ADD CONSTRAINT "contact_relation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relation" ADD CONSTRAINT "contact_relation_related_contact_id_contact_id_fk" FOREIGN KEY ("related_contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relation" ADD CONSTRAINT "contact_relation_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_date_contact_idx" ON "contact_date" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relation_pair_uq" ON "contact_relation" USING btree ("organization_id","contact_id","related_contact_id","type");--> statement-breakpoint
CREATE INDEX "contact_relation_related_idx" ON "contact_relation" USING btree ("organization_id","related_contact_id");--> statement-breakpoint
ALTER TABLE "contact_relation" ADD CONSTRAINT "contact_relation_not_self" CHECK ("contact_id" <> "related_contact_id");
