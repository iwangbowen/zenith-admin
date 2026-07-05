ALTER TABLE "report_alert_rules" ADD COLUMN "group_by_field" varchar(128);--> statement-breakpoint
ALTER TABLE "report_alert_rules" ADD COLUMN "webhook_url" varchar(512);--> statement-breakpoint
ALTER TABLE "report_dashboard_subscriptions" ADD COLUMN "webhook_url" varchar(512);--> statement-breakpoint
ALTER TABLE "report_datasets" ADD COLUMN "row_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;