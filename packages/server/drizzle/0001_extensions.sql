-- 手写 DDL：无法由 Drizzle schema 表达，`drizzle-kit generate` 不会重新生成它们，
-- 重建迁移基线时必须随基线一并保留（本文件为唯一收口，见 docs/backend/database.md「迁移目录」）。
-- 注：pg_trgm 扩展在 0000_baseline.sql 顶部创建（其索引已全部收进 schema DSL 随基线生成）。

-- ─── pgvector：Mastra PgVector 向量存储依赖（条件启用）──────────────────────────
-- 知识库向量由 Mastra PgVector 存放在 mastra schema（索引 kb_{kbId}），ai_kb_chunks 只存分块文本，
-- 业务表上没有任何 vector 列。扩展可用时在此预建，让全新库开箱即用；不可用时静默跳过——
-- Mastra 首次建索引时会再次 CREATE EXTENSION IF NOT EXISTS，届时才因缺扩展报错，其余功能不受影响。
-- 扩展创建与条件 DDL 均在 Drizzle 表达范围之外。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;--> statement-breakpoint

-- ─── iot_telemetry：按 reported_at 的 RANGE 日分区表（Drizzle schema 无法表达分区）──────
-- 不迁移历史明细：最新值在设备影子（iot_device_state），长窗口图表与仪表盘读小时聚合表（iot_telemetry_hourly），
-- 明细本身只保留 30 天。Drizzle 快照仍以普通表描述列 / 索引 / 外键（父表定义自动继承到每个分区）。
DROP TABLE IF EXISTS "iot_telemetry";--> statement-breakpoint
CREATE TABLE "iot_telemetry" (
	"device_id" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"reported_at" timestamp DEFAULT now() NOT NULL
) PARTITION BY RANGE ("reported_at");--> statement-breakpoint
ALTER TABLE "iot_telemetry" ADD CONSTRAINT "iot_telemetry_device_id_iot_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."iot_devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_iot_telemetry_device_time" ON "iot_telemetry" USING btree ("device_id","reported_at");--> statement-breakpoint
CREATE INDEX "idx_iot_telemetry_time_brin" ON "iot_telemetry" USING brin ("reported_at");--> statement-breakpoint
-- 初始分区：UTC 日 [昨天, 今天 + 7]，命名 iot_telemetry_pYYYYMMDD（与 iot-partitions.service 口径一致）。
-- 之后由系统任务「IoT 遥测分区维护」滚动预建，写入命中缺失分区时按需补建，保留策略按分区整表 DROP。
DO $$
DECLARE
  d date;
BEGIN
  FOR d IN
    SELECT generate_series((now() AT TIME ZONE 'UTC')::date - 1, (now() AT TIME ZONE 'UTC')::date + 7, interval '1 day')::date
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "iot_telemetry" FOR VALUES FROM (%L) TO (%L)',
      'iot_telemetry_p' || to_char(d, 'YYYYMMDD'), d::timestamp, (d + 1)::timestamp
    );
  END LOOP;
END $$;--> statement-breakpoint

-- ─── 跨实例缓存失效广播：cache_invalidate 频道 ────────────────────────────────────
-- 通用触发器函数：以表名为 topic，可选以 NEW/OLD 的某列为 key（触发器参数 TG_ARGV[0] 指定列名）。
-- NOTIFY 在事务提交后才投递，进程内副本不会读到未提交的失效；同一事务内相同 payload 由 PG 去重。
-- 服务端 lib/invalidation-bus.ts 监听该频道，各缓存按 topic 订阅。新增需跨实例失效的表只需再挂一个触发器。
CREATE OR REPLACE FUNCTION notify_cache_invalidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb;
  key_value text;
BEGIN
  rec := to_jsonb(COALESCE(NEW, OLD));
  IF TG_NARGS > 0 THEN
    key_value := rec ->> TG_ARGV[0];
  END IF;
  PERFORM pg_notify('cache_invalidate', json_build_object('topic', TG_TABLE_NAME, 'key', key_value)::text);
  RETURN NULL;
END $$;--> statement-breakpoint
-- 运行时设置：按模块广播（key = module），平台行改动会影响所有继承它的租户，订阅方按模块整段清空副本
CREATE TRIGGER system_settings_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "system_settings"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('module');--> statement-breakpoint

-- ─── 只读执行角色：用户手写 SQL（数据库管理控制台 / 导出 / 报表数据集）的最小权限 ─────────
-- 应用连接通常是库 owner 甚至 superuser；READ ONLY 事务挡不住 COPY TO PROGRAM、pg_read_file、
-- lo_export 等服务器端函数。这里创建 NOLOGIN 只读角色并授予 SELECT，应用在事务内 SET LOCAL ROLE 切换。
-- 无 CREATEROLE 权限的部署会跳过创建（不阻断迁移），服务端探测不到角色时降级为白名单 + READ ONLY 并打 warn。
DO $$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zenith_readonly') THEN
    BEGIN
      EXECUTE 'CREATE ROLE zenith_readonly NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE WARNING 'zenith_readonly 角色未创建：当前用户缺少 CREATEROLE，数据库控制台将退化为仅白名单+只读事务防护';
      RETURN;
    END;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO zenith_readonly', current_database());

  -- 所有业务 schema：SELECT 现有表 / 序列，并让未来新建对象自动继承
  FOR r IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO zenith_readonly', r.nspname);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO zenith_readonly', r.nspname);
    EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO zenith_readonly', r.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO zenith_readonly', r.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON SEQUENCES TO zenith_readonly', r.nspname);
  END LOOP;

  -- 应用用户后续新建的任意 schema 中的表 / 序列也默认可读（schema 的 USAGE 由服务端启动时补齐）
  EXECUTE 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO zenith_readonly';
  EXECUTE 'ALTER DEFAULT PRIVILEGES GRANT SELECT ON SEQUENCES TO zenith_readonly';

  -- 应用用户可 SET ROLE 到只读角色（角色 NOINHERIT，应用自身权限不受影响）
  EXECUTE format('GRANT zenith_readonly TO %I', current_user);

  -- 明确收回服务器端文件 / 程序能力（默认即无，防止被外部误授）；PG < 11 无这些预定义角色则忽略
  BEGIN
    EXECUTE 'REVOKE pg_read_server_files, pg_write_server_files, pg_execute_server_program FROM zenith_readonly';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;