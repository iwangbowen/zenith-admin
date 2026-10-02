CREATE TYPE "public"."workflow_approval_activation_status" AS ENUM('active', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_approval_slot_origin" AS ENUM('base', 'addSign');--> statement-breakpoint
CREATE TYPE "public"."workflow_approval_slot_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_sign_group_status" AS ENUM('waiting', 'active', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_sign_mode" AS ENUM('and', 'or');--> statement-breakpoint
CREATE TYPE "public"."workflow_sign_position" AS ENUM('before', 'after', 'parallel');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_kind" AS ENUM('approval', 'suggestion', 'cc', 'excluded', 'system');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_wait_reason" AS ENUM('sequence', 'beforeSign', 'afterSign', 'external', 'subprocess', 'delay', 'trigger');--> statement-breakpoint
CREATE TABLE "workflow_approval_slots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_approval_slots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"activation_id" varchar(36) NOT NULL,
	"origin" "workflow_approval_slot_origin" NOT NULL,
	"group_id" integer,
	"original_assignee_id" integer,
	"current_assignee_id" integer,
	"status" "workflow_approval_slot_status" DEFAULT 'pending' NOT NULL,
	"order" integer,
	"mandatory" boolean DEFAULT false NOT NULL,
	"current_task_id" integer,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_approval_slots_id_activation_unique" UNIQUE("id","activation_id"),
	CONSTRAINT "workflow_approval_slots_origin_group_check" CHECK (("workflow_approval_slots"."origin" = 'base' and "workflow_approval_slots"."group_id" is null) or ("workflow_approval_slots"."origin" = 'addSign' and "workflow_approval_slots"."group_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_node_activations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"instance_id" integer NOT NULL,
	"token_id" integer,
	"node_key" varchar(64) NOT NULL,
	"node_name" varchar(64) NOT NULL,
	"status" "workflow_approval_activation_status" DEFAULT 'active' NOT NULL,
	"approve_method" "workflow_approve_method",
	"approve_ratio" integer,
	"base_total" integer NOT NULL,
	"base_required" integer NOT NULL,
	"settled_at" timestamp with time zone,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_node_activations_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "workflow_node_activations_base_votes_check" CHECK ("workflow_node_activations"."base_required" >= 0 and "workflow_node_activations"."base_required" <= "workflow_node_activations"."base_total")
);
--> statement-breakpoint
CREATE TABLE "workflow_sign_groups" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_sign_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"activation_id" varchar(36) NOT NULL,
	"anchor_slot_id" integer NOT NULL,
	"position" "workflow_sign_position" NOT NULL,
	"sign_mode" "workflow_sign_mode" NOT NULL,
	"status" "workflow_sign_group_status" NOT NULL,
	"tenant_id" integer,
	"created_by" integer,
	"updated_by" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_tasks" ALTER COLUMN "activation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "slot_id" integer;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "task_kind" "workflow_task_kind" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD COLUMN "wait_reason" "workflow_task_wait_reason";--> statement-breakpoint
-- This release starts a new execution model. Retain previous execution facts,
-- but close old active runs rather than infer formal seats from task history.
UPDATE "workflow_instances" SET "status" = 'cancelled', "current_node_key" = NULL, "updated_at" = now() WHERE "status" IN ('running', 'suspended', 'returned');
--> statement-breakpoint
UPDATE "workflow_tasks" SET "activation_id" = NULL, "task_kind" = CASE WHEN "node_type" = 'ccNode' THEN 'cc'::workflow_task_kind ELSE 'system'::workflow_task_kind END, "status" = CASE WHEN "status" IN ('pending', 'waiting') THEN 'skipped'::workflow_task_status ELSE "status" END, "action_at" = CASE WHEN "status" IN ('pending', 'waiting') THEN now() ELSE "action_at" END;
--> statement-breakpoint
UPDATE "workflow_tokens" SET "status" = 'dead', "consumed_at" = now() WHERE "status" = 'active';
--> statement-breakpoint
UPDATE "workflow_jobs" SET "status" = 'canceled', "generation" = "generation" + 1, "lease_token" = NULL, "lease_until" = NULL, "locked_by" = NULL, "locked_at" = NULL, "execution_deadline" = NULL, "last_error" = 'Execution closed during explicit approval-seat migration', "updated_at" = now() WHERE "instance_id" IS NOT NULL AND "status" IN ('pending', 'running', 'paused');
--> statement-breakpoint
ALTER TABLE "workflow_tasks" ALTER COLUMN "task_kind" DROP DEFAULT;
--> statement-breakpoint

ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_activation_id_workflow_node_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."workflow_node_activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_group_id_workflow_sign_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."workflow_sign_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_original_assignee_id_users_id_fk" FOREIGN KEY ("original_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_current_assignee_id_users_id_fk" FOREIGN KEY ("current_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_current_task_id_workflow_tasks_id_fk" FOREIGN KEY ("current_task_id") REFERENCES "public"."workflow_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_approval_slots" ADD CONSTRAINT "workflow_approval_slots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD CONSTRAINT "workflow_node_activations_instance_id_workflow_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD CONSTRAINT "workflow_node_activations_token_id_workflow_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."workflow_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD CONSTRAINT "workflow_node_activations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD CONSTRAINT "workflow_node_activations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_node_activations" ADD CONSTRAINT "workflow_node_activations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sign_groups" ADD CONSTRAINT "workflow_sign_groups_activation_id_workflow_node_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."workflow_node_activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sign_groups" ADD CONSTRAINT "workflow_sign_groups_anchor_slot_id_workflow_approval_slots_id_fk" FOREIGN KEY ("anchor_slot_id") REFERENCES "public"."workflow_approval_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sign_groups" ADD CONSTRAINT "workflow_sign_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sign_groups" ADD CONSTRAINT "workflow_sign_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_sign_groups" ADD CONSTRAINT "workflow_sign_groups_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_approval_slots_activation_idx" ON "workflow_approval_slots" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "workflow_approval_slots_group_idx" ON "workflow_approval_slots" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "workflow_node_activations_instance_node_idx" ON "workflow_node_activations" USING btree ("instance_id","node_key");--> statement-breakpoint
CREATE INDEX "workflow_sign_groups_activation_idx" ON "workflow_sign_groups" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "workflow_sign_groups_anchor_idx" ON "workflow_sign_groups" USING btree ("anchor_slot_id");--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_slot_id_workflow_approval_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."workflow_approval_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_activation_id_workflow_node_activations_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."workflow_node_activations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_slot_activation_fk" FOREIGN KEY ("slot_id","activation_id") REFERENCES "public"."workflow_approval_slots"("id","activation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tasks" DROP COLUMN "task_order";--> statement-breakpoint
ALTER TABLE "workflow_tasks" DROP COLUMN "approve_method";--> statement-breakpoint
ALTER TABLE "workflow_tasks" DROP COLUMN "approve_ratio";--> statement-breakpoint
ALTER TABLE "workflow_tasks" DROP COLUMN "sign_type";--> statement-breakpoint
ALTER TABLE "workflow_tasks" ADD CONSTRAINT "workflow_tasks_formal_slot_check" CHECK ("workflow_tasks"."task_kind" not in ('approval', 'suggestion') or ("workflow_tasks"."slot_id" is not null and "workflow_tasks"."activation_id" is not null));