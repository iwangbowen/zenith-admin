ALTER TABLE "async_tasks" ADD COLUMN "trace_parent" varchar(128);--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN "trace_state" varchar(1024);--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "trace_parent" varchar(128);--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "trace_state" varchar(1024);--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "trace_parent" varchar(128);--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "trace_state" varchar(1024);--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "trace_parent" varchar(128);--> statement-breakpoint
ALTER TABLE "event_outbox" ADD COLUMN "trace_state" varchar(1024);