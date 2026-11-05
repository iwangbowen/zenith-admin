-- Business correlation IDs replace the ambiguous legacy request/trace column names.
-- These are explicit renames so existing correlation values and indexes are preserved.
ALTER TABLE "async_tasks" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "domain_events" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "event_outbox" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "error_events" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "workflow_jobs" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "notification_outbox" RENAME COLUMN "trace_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "operation_logs" RENAME COLUMN "request_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "api_access_logs" RENAME COLUMN "request_id" TO "correlation_id";--> statement-breakpoint
ALTER TABLE "open_api_call_logs" RENAME COLUMN "request_id" TO "correlation_id";--> statement-breakpoint
ALTER INDEX "async_tasks_trace_idx" RENAME TO "async_tasks_correlation_idx";--> statement-breakpoint
ALTER INDEX "domain_events_trace_idx" RENAME TO "domain_events_correlation_idx";--> statement-breakpoint
ALTER INDEX "event_outbox_trace_idx" RENAME TO "event_outbox_correlation_idx";--> statement-breakpoint
ALTER INDEX "error_events_trace_idx" RENAME TO "error_events_correlation_idx";--> statement-breakpoint
ALTER INDEX "workflow_jobs_trace_idx" RENAME TO "workflow_jobs_correlation_idx";--> statement-breakpoint
ALTER INDEX "notification_outbox_trace_idx" RENAME TO "notification_outbox_correlation_idx";--> statement-breakpoint
ALTER INDEX "operation_logs_request_idx" RENAME TO "operation_logs_correlation_idx";--> statement-breakpoint
ALTER INDEX "api_access_logs_request_idx" RENAME TO "api_access_logs_correlation_idx";
