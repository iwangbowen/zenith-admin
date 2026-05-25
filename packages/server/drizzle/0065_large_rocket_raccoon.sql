ALTER TABLE "workflow_instances" ADD COLUMN "parent_instance_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "parent_task_id" integer;