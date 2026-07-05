ALTER TABLE "workflow_comments" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "in_app_messages" ADD COLUMN "link" varchar(512);--> statement-breakpoint
ALTER TABLE "workflow_comments" ADD CONSTRAINT "workflow_comments_parent_id_workflow_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."workflow_comments"("id") ON DELETE set null ON UPDATE no action;