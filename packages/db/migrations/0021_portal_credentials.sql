ALTER TABLE "portal_account" ADD COLUMN "credentials_encrypted" text;--> statement-breakpoint
ALTER TABLE "portal_account" ADD COLUMN "credential_hints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_account" ADD COLUMN "tokens_encrypted" text;--> statement-breakpoint
ALTER TABLE "portal_account" ADD COLUMN "connection" jsonb;--> statement-breakpoint
ALTER TABLE "portal_account" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_account" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "property_publication" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "property_publication" ADD COLUMN "sync_error" text;