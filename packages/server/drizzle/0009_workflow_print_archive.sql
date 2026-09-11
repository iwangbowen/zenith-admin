ALTER TABLE "workflow_instances" ADD COLUMN "archive_file_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "archive_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "archive_template_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_archive_file_id_managed_files_id_fk" FOREIGN KEY ("archive_file_id") REFERENCES "public"."managed_files"("id") ON DELETE set null ON UPDATE no action;