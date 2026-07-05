ALTER TYPE "public"."workflow_instance_status" ADD VALUE 'suspended' BEFORE 'approved';--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD COLUMN "suspend_reason" varchar(500);