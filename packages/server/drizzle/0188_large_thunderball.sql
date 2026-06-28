ALTER TABLE "workflow_connectors" ADD COLUMN "rate_limit_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD COLUMN "rate_limit_window_sec" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_connectors" ADD COLUMN "rate_limit_max" integer DEFAULT 0 NOT NULL;