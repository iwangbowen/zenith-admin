CREATE TYPE "public"."process_role" AS ENUM('api', 'worker');--> statement-breakpoint
ALTER TABLE "async_tasks" ADD COLUMN "node_id" varchar(128);--> statement-breakpoint
-- 节点心跳行是进程运行期的临时状态，进程重启即重建；清空后再加非空列，避免历史行没有角色值
DELETE FROM "system_scheduler_nodes";--> statement-breakpoint
ALTER TABLE "system_scheduler_nodes" ADD COLUMN "roles" "process_role"[] NOT NULL;
