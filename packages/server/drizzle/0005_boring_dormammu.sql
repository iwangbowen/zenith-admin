ALTER TABLE "workflow_instances" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "draft_form_revision" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "draft_intent" jsonb;