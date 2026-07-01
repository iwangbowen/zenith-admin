CREATE TYPE "public"."system_scheduler_run_status" AS ENUM('running', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_task_type" AS ENUM('recurring', 'queue');--> statement-breakpoint
CREATE TYPE "public"."system_scheduler_trigger_type" AS ENUM('schedule', 'manual', 'queue');--> statement-breakpoint
CREATE TABLE "system_scheduler_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_name" varchar(128) NOT NULL,
	"task_title" varchar(128) NOT NULL,
	"task_type" "system_scheduler_task_type" NOT NULL,
	"module" varchar(64) DEFAULT '系统' NOT NULL,
	"trigger_type" "system_scheduler_trigger_type" NOT NULL,
	"status" "system_scheduler_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer,
	"result_message" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_task_idx" ON "system_scheduler_runs" USING btree ("task_name");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_status_idx" ON "system_scheduler_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_started_at_idx" ON "system_scheduler_runs" USING btree ("started_at");
--> statement-breakpoint
INSERT INTO "menus" ("id", "parent_id", "title", "name", "path", "component", "icon", "type", "permission", "sort", "status", "visible", "created_at", "updated_at")
VALUES
  (535, 200, '系统调度', 'SystemScheduler', '/system/scheduler', 'system/scheduler/SystemSchedulerPage', 'Timer', 'menu', 'system:scheduler:view', 18, 'enabled', true, now(), now()),
  (536, 535, '手动执行', null, null, null, null, 'button', 'system:scheduler:run', 1, 'enabled', true, now(), now())
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
JOIN "menus" m ON m."id" IN (535, 536)
WHERE r."code" = 'super_admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
SELECT setval('menus_id_seq', GREATEST((SELECT MAX("id") FROM "menus"), 1));
