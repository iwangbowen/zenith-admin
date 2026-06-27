CREATE TABLE "system_scheduler_task_configs" (
	"task_name" varchar(128) PRIMARY KEY NOT NULL,
	"log_retention_days" integer DEFAULT 30 NOT NULL,
	"log_retention_runs" integer DEFAULT 1000 NOT NULL,
	"timeout_ms" integer,
	"failure_alert_threshold" integer DEFAULT 1 NOT NULL,
	"alert_enabled" boolean DEFAULT true NOT NULL,
	"manual_singleton" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "job_id" varchar(128);--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "node_id" varchar(128);--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "node_hostname" varchar(128);--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "node_pid" integer;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "triggered_by" integer;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alerted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD COLUMN "alert_message" text;--> statement-breakpoint
ALTER TABLE "system_scheduler_runs" ADD CONSTRAINT "system_scheduler_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_scheduler_runs_triggered_by_idx" ON "system_scheduler_runs" USING btree ("triggered_by");--> statement-breakpoint
INSERT INTO "menus" ("id", "parent_id", "title", "type", "sort", "status", "visible", "permission", "created_at", "updated_at")
VALUES
  (537, 535, '调整策略', 'button', 2, 'enabled', true, 'system:scheduler:config', now(), now()),
  (538, 535, '清理日志', 'button', 3, 'enabled', true, 'system:scheduler:cleanup', now(), now())
ON CONFLICT ("id") DO UPDATE SET
  "parent_id" = EXCLUDED."parent_id",
  "title" = EXCLUDED."title",
  "type" = EXCLUDED."type",
  "sort" = EXCLUDED."sort",
  "status" = EXCLUDED."status",
  "visible" = EXCLUDED."visible",
  "permission" = EXCLUDED."permission",
  "updated_at" = now();--> statement-breakpoint
INSERT INTO "role_menus" ("role_id", "menu_id")
SELECT r."id", m."id"
FROM "roles" r
JOIN "menus" m ON m."id" IN (537, 538)
WHERE r."code" = 'super_admin'
ON CONFLICT DO NOTHING;
