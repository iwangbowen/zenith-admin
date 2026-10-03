ALTER TYPE "public"."monitor_metric" ADD VALUE 'jobsBacklog' BEFORE 'workflowHealth';--> statement-breakpoint
ALTER TYPE "public"."monitor_metric" ADD VALUE 'jobsStuck' BEFORE 'workflowHealth';--> statement-breakpoint
ALTER TYPE "public"."monitor_metric" ADD VALUE 'jobsDead' BEFORE 'workflowHealth';--> statement-breakpoint
ALTER TYPE "public"."monitor_metric" ADD VALUE 'jobsFailed1h' BEFORE 'workflowHealth';--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_metric_samples" ADD COLUMN "jobs_backlog" real;--> statement-breakpoint
ALTER TABLE "system_metric_samples" ADD COLUMN "jobs_stuck" real;--> statement-breakpoint
ALTER TABLE "system_metric_samples" ADD COLUMN "jobs_dead" real;--> statement-breakpoint
ALTER TABLE "system_metric_samples" ADD COLUMN "jobs_failed1h" real;--> statement-breakpoint
CREATE INDEX "notification_outbox_claimed_idx" ON "notification_outbox" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "notification_outbox_finished_idx" ON "notification_outbox" USING btree ("status","finished_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_retry_idx" ON "app_webhook_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_started_idx" ON "app_webhook_deliveries" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "app_webhook_deliveries_status_finished_idx" ON "app_webhook_deliveries" USING btree ("status","finished_at");
