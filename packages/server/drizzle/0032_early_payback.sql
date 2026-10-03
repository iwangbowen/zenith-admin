CREATE INDEX "async_tasks_status_heartbeat_idx" ON "async_tasks" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE INDEX "async_tasks_status_next_run_idx" ON "async_tasks" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "async_tasks_status_completed_idx" ON "async_tasks" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "export_jobs_status_started_idx" ON "export_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "export_jobs_status_completed_idx" ON "export_jobs" USING btree ("status","completed_at");--> statement-breakpoint
CREATE INDEX "cron_job_logs_status_ended_idx" ON "cron_job_logs" USING btree ("status","ended_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_status_started_idx" ON "system_scheduler_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_status_ended_idx" ON "system_scheduler_runs" USING btree ("status","ended_at");--> statement-breakpoint
CREATE INDEX "workflow_job_executions_status_finished_idx" ON "workflow_job_executions" USING btree ("status","finished_at");--> statement-breakpoint
CREATE INDEX "workflow_jobs_deadline_idx" ON "workflow_jobs" USING btree ("status","execution_deadline");