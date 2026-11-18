CREATE TYPE "public"."workflow_activation_kind" AS ENUM('approval', 'system', 'repair', 'cc');--> statement-breakpoint
CREATE TYPE "public"."workflow_external_effect_status" AS ENUM('not_started', 'rejected_before_send', 'sent_unknown', 'confirmed_success', 'confirmed_failure');--> statement-breakpoint
ALTER TABLE "workflow_compensations" ADD COLUMN "repair_activation_id" varchar(36);--> statement-breakpoint
ALTER TABLE "workflow_compensations" ADD COLUMN "repair_task_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_job_executions" ADD COLUMN "effect_status" "workflow_external_effect_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "effect_status" "workflow_external_effect_status" DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD COLUMN "effect_evidence" text;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD COLUMN "kind" "workflow_activation_kind" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD COLUMN "settlement_reason" text;