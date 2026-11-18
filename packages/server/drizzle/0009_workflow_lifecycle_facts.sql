ALTER TABLE "workflow_instances" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "outcome_reason" varchar(64);--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "cycle" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_paused_remaining_ms" bigint;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "sla_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "breached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "paused_duration_ms" bigint DEFAULT 0 NOT NULL;