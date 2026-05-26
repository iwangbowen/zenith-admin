ALTER TABLE "workflow_tasks" ADD COLUMN "original_assignee_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "transfer_chain" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "delegated_from_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_original_assignee_id_users_id_fk" FOREIGN KEY ("original_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_delegated_from_id_users_id_fk" FOREIGN KEY ("delegated_from_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;