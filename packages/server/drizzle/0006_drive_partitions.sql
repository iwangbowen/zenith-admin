-- 手写 DDL（重建基线时并回 0001_extensions.sql）：网盘动态与外链访问日志改为按 created_at 的 RANGE 月分区表。
-- 两表均为追加型高频日志，保留策略按分区整表 DROP；重建前在本迁移事务内暂存已有日志。
-- Drizzle schema 仍以普通表描述列 / 索引 / 外键（父表定义自动继承到每个分区）；
-- 分区键必须进主键，因此两表不设代理主键，`id` 只是无约束的序号列，列表按 (created_at, id) 倒序。
-- 分区命名 drive_activities_pYYYYMM / drive_share_access_logs_pYYYYMM（UTC 月边界），
-- 由系统任务「网盘日志分区维护」滚动预建，写入命中缺失分区时按需补建（services/drive/drive-partitions.service.ts）。

-- ─── drive_activities ─────────────────────────────────────────────────────────
CREATE TEMP TABLE "_drive_activities_before_partition" ON COMMIT DROP AS SELECT * FROM "drive_activities";--> statement-breakpoint
CREATE TEMP TABLE "_drive_share_logs_before_partition" ON COMMIT DROP AS SELECT * FROM "drive_share_access_logs";--> statement-breakpoint
DROP TABLE IF EXISTS "drive_activities";--> statement-breakpoint
CREATE TABLE "drive_activities" (
	"id" integer GENERATED ALWAYS AS IDENTITY (sequence name "drive_activities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"space_id" integer NOT NULL,
	"node_id" integer,
	"node_name" varchar(255) NOT NULL,
	"node_type" "drive_node_type" NOT NULL,
	"action" "drive_activity_action" NOT NULL,
	"actor_id" integer,
	"share_id" integer,
	"detail" jsonb,
	"client_ip" varchar(64),
	"tenant_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_activities" ADD CONSTRAINT "drive_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_activities_node_idx" ON "drive_activities" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_activities_space_idx" ON "drive_activities" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_activities_actor_idx" ON "drive_activities" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_activities_created_brin_idx" ON "drive_activities" USING brin ("created_at");--> statement-breakpoint

-- ─── drive_share_access_logs ──────────────────────────────────────────────────
DROP TABLE IF EXISTS "drive_share_access_logs";--> statement-breakpoint
CREATE TABLE "drive_share_access_logs" (
	"id" integer GENERATED ALWAYS AS IDENTITY (sequence name "drive_share_access_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"share_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"action" varchar(16) NOT NULL,
	"client_ip" varchar(64),
	"ok" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
ALTER TABLE "drive_share_access_logs" ADD CONSTRAINT "drive_share_access_logs_share_id_drive_share_links_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."drive_share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drive_share_access_logs_share_idx" ON "drive_share_access_logs" USING btree ("share_id","created_at");--> statement-breakpoint
CREATE INDEX "drive_share_access_logs_created_brin_idx" ON "drive_share_access_logs" USING brin ("created_at");--> statement-breakpoint

-- ─── 初始分区：UTC 月 [上月, 下下月]，之后由系统任务滚动预建 ─────────────────────
DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT month FROM (
      SELECT generate_series(
      date_trunc('month', (now() AT TIME ZONE 'UTC'))::date - interval '1 month',
      date_trunc('month', (now() AT TIME ZONE 'UTC'))::date + interval '2 month',
      interval '1 month'
      )::date AS month
      UNION SELECT date_trunc('month', created_at)::date FROM "_drive_activities_before_partition"
      UNION SELECT date_trunc('month', created_at)::date FROM "_drive_share_logs_before_partition"
    ) months ORDER BY month
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "drive_activities" FOR VALUES FROM (%L) TO (%L)',
      'drive_activities_p' || to_char(m, 'YYYYMM'), m::timestamp, (m + interval '1 month')::timestamp
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "drive_share_access_logs" FOR VALUES FROM (%L) TO (%L)',
      'drive_share_access_logs_p' || to_char(m, 'YYYYMM'), m::timestamp, (m + interval '1 month')::timestamp
    );
  END LOOP;
END $$;--> statement-breakpoint
INSERT INTO "drive_activities"
("id", "space_id", "node_id", "node_name", "node_type", "action", "actor_id", "share_id", "detail", "client_ip", "tenant_id", "created_at")
OVERRIDING SYSTEM VALUE
SELECT "id", "space_id", "node_id", "node_name", "node_type", "action", "actor_id", "share_id", "detail", "client_ip", "tenant_id", "created_at"
FROM "_drive_activities_before_partition";--> statement-breakpoint
INSERT INTO "drive_share_access_logs"
("id", "share_id", "node_id", "action", "client_ip", "ok", "created_at")
OVERRIDING SYSTEM VALUE
SELECT "id", "share_id", "node_id", "action", "client_ip", "ok", "created_at"
FROM "_drive_share_logs_before_partition";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('drive_activities', 'id'), greatest(coalesce(max(id), 1), 1), count(*) > 0) FROM "drive_activities";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('drive_share_access_logs', 'id'), greatest(coalesce(max(id), 1), 1), count(*) > 0) FROM "drive_share_access_logs";
