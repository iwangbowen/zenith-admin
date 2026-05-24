ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "initiator_scope_type" varchar(16) DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD COLUMN IF NOT EXISTS "initiator_scope_ids" jsonb;
