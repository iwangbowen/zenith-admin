ALTER TABLE "workflow_task_urges" ADD COLUMN "assignee_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD COLUMN "assignee_name" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD COLUMN "node_key" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD COLUMN "node_name" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_task_urges" ADD CONSTRAINT "workflow_task_urges_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;