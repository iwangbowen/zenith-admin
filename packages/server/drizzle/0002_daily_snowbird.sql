ALTER TABLE "export_jobs" ADD COLUMN "task_id" integer;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "execution_token" uuid;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "cancel_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "stage" varchar(32) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_task_idx" ON "export_jobs" USING btree ("task_id");