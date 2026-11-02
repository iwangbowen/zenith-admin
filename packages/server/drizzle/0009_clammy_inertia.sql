ALTER TABLE "payment_event_attempts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_events" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "payment_event_attempts" CASCADE;--> statement-breakpoint
DROP TABLE "payment_events" CASCADE;--> statement-breakpoint
DROP INDEX "open_quota_alerts_status_idx";--> statement-breakpoint
CREATE INDEX "open_quota_alerts_created_idx" ON "open_quota_alerts" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "event_id";--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "attempt";--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "started_at";--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "sent_at";--> statement-breakpoint
ALTER TABLE "open_quota_alerts" DROP COLUMN "last_error";--> statement-breakpoint
DROP TYPE "public"."payment_event_attempt_status";--> statement-breakpoint
DROP TYPE "public"."payment_event_status";--> statement-breakpoint
DELETE FROM "cron_jobs" WHERE "handler" = 'dispatchPaymentEvents';--> statement-breakpoint
DELETE FROM "retention_policies" WHERE "policy_key" = 'payment_events';
