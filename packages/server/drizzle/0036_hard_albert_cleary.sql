ALTER TABLE "report_delivery_runs" ADD COLUMN "task_id" integer;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD COLUMN "task_id" integer;--> statement-breakpoint
ALTER TABLE "report_delivery_runs" ADD CONSTRAINT "report_delivery_runs_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dq_runs" ADD CONSTRAINT "report_dq_runs_task_id_async_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."async_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_campaigns_status_updated_idx" ON "broadcast_campaigns" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "broadcast_campaigns_task_idx" ON "broadcast_campaigns" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "payment_recon_runs_status_started_idx" ON "payment_recon_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "payment_recon_runs_status_finished_idx" ON "payment_recon_runs" USING btree ("status","finished_at");--> statement-breakpoint
CREATE INDEX "deploy_run_hosts_status_started_idx" ON "deploy_run_hosts" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "deploy_runs_status_started_idx" ON "deploy_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "deploy_runs_status_finished_idx" ON "deploy_runs" USING btree ("status","finished_at");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_task_idx" ON "report_delivery_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_status_started_idx" ON "report_delivery_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "report_delivery_runs_status_completed_idx" ON "report_delivery_runs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "report_dq_runs_task_idx" ON "report_dq_runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "report_dq_runs_status_started_idx" ON "report_dq_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "report_dq_runs_status_completed_idx" ON "report_dq_runs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "cms_media_processing_status_updated_idx" ON "cms_media_processing" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "cms_deployments_status_created_idx" ON "cms_deployments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "cms_delivery_runs_status_started_idx" ON "cms_delivery_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "cms_delivery_runs_purge_created_idx" ON "cms_delivery_runs" USING btree ("purge_status","created_at");--> statement-breakpoint
CREATE INDEX "cms_delivery_runs_status_completed_idx" ON "cms_delivery_runs" USING btree ("status","completed_at");