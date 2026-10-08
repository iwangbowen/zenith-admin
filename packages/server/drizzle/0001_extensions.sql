-- 手写 DDL：Drizzle schema 无法表达、drizzle-kit generate 不会生成的结构，随迁移基线一起维护（唯一收口，
-- 见 docs/backend/database.md「迁移目录」）。pg_trgm 扩展在 0000_baseline.sql 顶部创建。
-- 内容：pgvector（条件）、三张 RANGE 分区表的初始分区、跨实例缓存失效触发器、CMS 不可变事实触发器、
-- 只读执行角色 zenith_readonly、pg_stat_statements（条件）。
-- 三张分区父表及其列 / 外键 / 索引直接在 0000_baseline.sql 中创建；本文件只预建初始子分区，
-- 不删除或重建父表。分区边界一律写带 +00 的 timestamptz 字面量（UTC 日 / 月边界）。

-- ─── pgvector：Mastra PgVector 向量存储依赖（条件启用）──────────────────────────
-- 知识库向量由 Mastra PgVector 存放在 mastra schema（索引 kb_{kbId}），ai_kb_chunks 只存分块文本，
-- 业务表上没有任何 vector 列。扩展可用时在此预建，让全新库开箱即用；不可用时静默跳过——
-- Mastra 首次建索引时会再次 CREATE EXTENSION IF NOT EXISTS，届时才因缺扩展报错，其余功能不受影响。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;--> statement-breakpoint

-- ─── iot_telemetry：按 reported_at 的 RANGE 日分区表的初始分区 ──────────────────────
-- 最新值在设备影子（iot_device_state），长窗口图表与仪表盘读小时聚合表（iot_telemetry_hourly），明细只保留 30 天。
-- Drizzle 快照描述列 / 索引 / 外键，基准 SQL 直接声明 PARTITION BY；父表定义自动继承到每个分区。
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
      'iot_telemetry_p' || to_char(d, 'YYYYMMDD'),
      to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  END LOOP;
END $$;--> statement-breakpoint

-- ─── 企业网盘日志：drive_activities / drive_share_access_logs 的初始 RANGE 月分区 ──────
-- 两表均为追加型高频日志，保留策略按分区整表 DROP。分区键必须进主键，因此不设代理主键，
-- `id` 只是无约束的 identity 序号列，列表按 (created_at, id) 倒序。
-- 分区命名 drive_activities_pYYYYMM / drive_share_access_logs_pYYYYMM（UTC 月边界），
-- 由系统任务「网盘日志分区维护」滚动预建，写入命中缺失分区时按需补建（services/drive/drive-partitions.service.ts）。
-- 初始分区：UTC 月 [上月, 下下月]，之后由系统任务滚动预建
DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(
      date_trunc('month', now() AT TIME ZONE 'UTC')::date - interval '1 month',
      date_trunc('month', now() AT TIME ZONE 'UTC')::date + interval '2 month',
      interval '1 month'
    )::date
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "drive_activities" FOR VALUES FROM (%L) TO (%L)',
      'drive_activities_p' || to_char(m, 'YYYYMM'),
      to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "drive_share_access_logs" FOR VALUES FROM (%L) TO (%L)',
      'drive_share_access_logs_p' || to_char(m, 'YYYYMM'),
      to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00',
      to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00'
    );
  END LOOP;
END $$;--> statement-breakpoint

-- ─── 跨实例缓存失效广播：cache_invalidate 频道 ────────────────────────────────────
-- 通用触发器函数：以表名为 topic，可选以 NEW/OLD 的某列为 key（触发器参数 TG_ARGV[0] 指定列名）。
-- NOTIFY 在事务提交后才投递，进程内副本不会读到未提交的失效；同一事务内相同 payload 由 PG 去重。
-- 服务端 lib/invalidation-bus.ts 监听该频道，各缓存按 topic 订阅（onInvalidate）；订阅的每张表都必须在此挂触发器
-- （lib/invalidation-triggers.test.ts 守卫）。
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
-- 数据脱敏策略：策略变更后所有实例的进程内策略缓存立即失效
CREATE TRIGGER data_mask_policies_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "data_mask_policies"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate();--> statement-breakpoint
-- 鉴权主体校验缓存（middleware/auth.ts）：users / tenants 权威行的进程内副本
CREATE TRIGGER users_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "users"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
CREATE TRIGGER tenants_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
-- 会员鉴权主体校验缓存（middleware/member-auth.ts）；会员侧租户活性复用 tenants 触发器
CREATE TRIGGER members_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "members"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
-- API Token 主体副本（middleware/auth.ts 的 apiTokenRows）：按 token_hash 键、无 id 反向索引，订阅方收到即整段清空
CREATE TRIGGER user_api_tokens_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "user_api_tokens"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
-- 套餐功能集副本（lib/tenant-package.ts）：租户改绑套餐由 tenants 触发器覆盖，套餐本体与套餐-功能关联在此广播
CREATE TRIGGER tenant_packages_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenant_packages"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('id');--> statement-breakpoint
CREATE TRIGGER tenant_package_features_cache_invalidate
  AFTER INSERT OR UPDATE OR DELETE ON "tenant_package_features"
  FOR EACH ROW EXECUTE FUNCTION notify_cache_invalidate('package_id');--> statement-breakpoint

-- ─── CMS 不可变事实：修订、审批、版本、发布输入与只追加历史禁止改写 ─────────────────────
-- 修订 / 审批 / 复审 / 模型、资源、组件、页面预设、集合版本 / 发布激活：除审计列外任何字段变化即拒绝
CREATE OR REPLACE FUNCTION cms_immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['created_by', 'updated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['created_by', 'updated_by']) THEN
    RAISE EXCEPTION 'CMS revisions and approval facts are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER cms_content_revisions_immutable BEFORE UPDATE ON cms_content_revisions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_content_approvals_immutable BEFORE UPDATE ON cms_content_revision_approvals FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_content_review_immutable BEFORE UPDATE ON cms_content_review_revisions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_model_versions_immutable BEFORE UPDATE ON cms_model_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_asset_versions_immutable BEFORE UPDATE ON cms_asset_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_release_activations_immutable BEFORE UPDATE ON cms_release_activations FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_page_preset_versions_immutable BEFORE UPDATE ON cms_page_preset_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_component_versions_immutable BEFORE UPDATE ON cms_component_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
CREATE TRIGGER cms_collection_versions_immutable BEFORE UPDATE ON cms_content_collection_versions FOR EACH ROW EXECUTE FUNCTION cms_immutable_revision();--> statement-breakpoint
-- 发布单：站点与来源不可变；输入只允许未构建的配置草稿吸收后续保存、内容发布在 draft / failed 重试时推进公开基线
CREATE OR REPLACE FUNCTION cms_release_configuration_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.site_id IS DISTINCT FROM OLD.site_id OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'CMS release identity and source are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.items IS DISTINCT FROM OLD.items
    OR NEW.configuration_items IS DISTINCT FROM OLD.configuration_items
    OR NEW.configuration_snapshot IS DISTINCT FROM OLD.configuration_snapshot
    OR NEW.base_generation_id IS DISTINCT FROM OLD.base_generation_id THEN
    -- Only an unbuilt configuration working draft can absorb subsequent saves.
    IF OLD.source = 'configuration' AND OLD.status = 'draft' AND NEW.status = 'draft'
      AND OLD.deployment_id IS NULL AND NEW.deployment_id IS NULL
      AND OLD.items = '[]'::jsonb AND NEW.items = '[]'::jsonb THEN
      RETURN NEW;
    END IF;
    -- Content revisions remain fixed; retrying a content-only build may advance its public baseline.
    IF OLD.source = 'content' AND OLD.status IN ('draft', 'failed') AND NEW.status = OLD.status
      AND NEW.deployment_id IS NOT DISTINCT FROM OLD.deployment_id
      AND OLD.configuration_items = '[]'::jsonb AND NEW.configuration_items = '[]'::jsonb
      AND NEW.items IS NOT DISTINCT FROM OLD.items
      AND NEW.configuration_snapshot IS NOT DISTINCT FROM OLD.configuration_snapshot THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CMS release inputs are immutable after build; create another release' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER cms_release_inputs_immutable BEFORE UPDATE ON cms_releases FOR EACH ROW EXECUTE FUNCTION cms_release_configuration_immutable();--> statement-breakpoint
-- 反馈处理历史：只追加，禁止 UPDATE / DELETE / TRUNCATE
CREATE OR REPLACE FUNCTION cms_feedback_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CMS feedback history is immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER cms_feedback_history_no_update_delete BEFORE UPDATE OR DELETE ON cms_feedback_history FOR EACH ROW EXECUTE FUNCTION cms_feedback_history_immutable();--> statement-breakpoint
CREATE TRIGGER cms_feedback_history_no_truncate BEFORE TRUNCATE ON cms_feedback_history FOR EACH STATEMENT EXECUTE FUNCTION cms_feedback_history_immutable();--> statement-breakpoint
-- 编辑任务历史：只追加，禁止 UPDATE / DELETE / TRUNCATE
CREATE OR REPLACE FUNCTION cms_editorial_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CMS editorial task history is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER cms_editorial_history_no_update_delete BEFORE UPDATE OR DELETE ON cms_editorial_task_history FOR EACH ROW EXECUTE FUNCTION cms_editorial_history_immutable();--> statement-breakpoint
CREATE TRIGGER cms_editorial_history_no_truncate BEFORE TRUNCATE ON cms_editorial_task_history FOR EACH STATEMENT EXECUTE FUNCTION cms_editorial_history_immutable();--> statement-breakpoint

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

  -- 明确收回服务器端文件 / 程序能力（默认即无，防止被外部误授）
  BEGIN
    EXECUTE 'REVOKE pg_read_server_files, pg_write_server_files, pg_execute_server_program FROM zenith_readonly';
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;--> statement-breakpoint

-- ─── pg_stat_statements：需要 PostgreSQL 启动时配置 shared_preload_libraries；不可用时保留降级能力 ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_stat_statements') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_stat_statements extension unavailable: %', SQLERRM;
    END;
  END IF;
END $$;
