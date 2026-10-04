/**
 * 用户手写 SQL（数据库管理控制台 / 导出 / 报表数据集 / 数据质量自定义 SQL）的最小权限执行环境。
 *
 * 应用自身通常以库 owner 甚至 superuser 连接；READ ONLY 事务只挡 DML，挡不住
 * `COPY ... TO PROGRAM`、`pg_read_file`、`lo_export` 这类服务器端文件 / 程序函数，也挡不住
 * `set_config('role', ...)`。`0001_extensions.sql` 创建 NOLOGIN 角色 zenith_readonly（仅 SELECT，无
 * pg_read_server_files / pg_execute_server_program 等特权）并把应用用户加入其中；执行用户 SQL 的
 * 事务里先 `SET LOCAL ROLE zenith_readonly`，让 PostgreSQL 自己拒绝越权，白名单 / 黑名单只是第一道闸。
 *
 * 角色不可用（迁移未跑、应用用户无 CREATEROLE 导致创建被跳过）时降级为只用白名单 + READ ONLY，
 * 并在首次探测时打 warn，不阻断数据库管理页可用性。
 */
import { sql } from 'drizzle-orm';
import { db } from '../db';
import type { DbTransaction } from '../db/types';
import { APP_TIME_ZONE_LITERAL } from './datetime-sql';
import logger from './logger';

export const DB_READONLY_ROLE = 'zenith_readonly';

const SYSTEM_SCHEMAS_SQL = `('pg_catalog', 'information_schema', 'pg_toast')`;

let availability: Promise<boolean> | null = null;

/**
 * 应用运行期可能新建 schema（如 mastra）；迁移只能覆盖当时已存在的 schema。
 * 进程内首次使用角色前补齐缺失的 USAGE / SELECT，失败仅记录，不影响探测结果。
 */
async function ensureSchemaGrants(): Promise<void> {
  try {
    await db.execute(sql.raw(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT nspname FROM pg_namespace
          WHERE nspname NOT IN ${SYSTEM_SCHEMAS_SQL}
            AND nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%'
            AND NOT has_schema_privilege('${DB_READONLY_ROLE}', nspname, 'USAGE')
        LOOP
          EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${DB_READONLY_ROLE}', r.nspname);
          EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO ${DB_READONLY_ROLE}', r.nspname);
          EXECUTE format('GRANT SELECT ON ALL SEQUENCES IN SCHEMA %I TO ${DB_READONLY_ROLE}', r.nspname);
        END LOOP;
      END $$
    `));
  } catch (err) {
    logger.debug('[db-readonly-role] 补齐 schema 授权失败（非致命）', err);
  }
}

async function probe(): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT pg_has_role(current_user, ${DB_READONLY_ROLE}, 'MEMBER') AS member
      FROM pg_roles WHERE rolname = ${DB_READONLY_ROLE}
    `) as unknown as Array<{ member: boolean }>;
    const ok = rows.length > 0 && rows[0].member === true;
    if (!ok) {
      logger.warn(`[db-readonly-role] 角色 ${DB_READONLY_ROLE} 不存在或当前数据库用户不是其成员，用户 SQL 将仅依赖只读事务 + 白名单执行；请确认 0001_extensions.sql 已执行且应用用户具备 CREATEROLE`);
      return false;
    }
    await ensureSchemaGrants();
    return true;
  } catch (err) {
    logger.warn('[db-readonly-role] 探测只读角色失败，按不可用处理', err);
    return false;
  }
}

/** 只读角色是否可用（进程内缓存首次成功结果；不可用不缓存，下次调用重试） */
export function isDbReadonlyRoleAvailable(): Promise<boolean> {
  if (!availability) {
    availability = probe().then((ok) => {
      if (!ok) availability = null;
      return ok;
    });
  }
  return availability;
}

/** 供单测 / 迁移后刷新 */
export function resetDbReadonlyRoleCache(): void {
  availability = null;
}

export interface ReadonlyTransactionGuardOptions {
  /** statement_timeout：PostgreSQL 时长写法（如 '60s'）或毫秒数 */
  timeout: string | number;
  /** 是否同时设置 idle_in_transaction_session_timeout（游标分批导出时防止连接挂死） */
  idleTimeout?: boolean;
}

/** 面向人的 SQL：事务内把会话时区切到 APP_TIME_ZONE（SET LOCAL，事务结束自动还原） */
export function applyAppTimeZoneSession(run: (statement: string) => Promise<unknown>): Promise<unknown> {
  return run(`SET LOCAL TimeZone = ${APP_TIME_ZONE_LITERAL}`);
}

export function withAppTimeZoneSession<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await applyAppTimeZoneSession((statement) => tx.execute(sql.raw(statement)));
    return fn(tx);
  });
}

/**
 * 在已开启的事务内应用用户 SQL 执行护栏：会话时区 + READ ONLY + 超时 + SET LOCAL ROLE zenith_readonly。
 * 调用方传入「执行一条原始 SQL」的函数，兼容 drizzle 事务（tx.execute(sql.raw(...))）与
 * postgres-js 事务（tx.unsafe(...)）。SET LOCAL 随事务结束自动还原，不污染连接池。
 */
export async function applyReadonlyTransactionGuards(
  run: (statement: string) => Promise<unknown>,
  options: ReadonlyTransactionGuardOptions,
): Promise<void> {
  await applyAppTimeZoneSession(run);
  await run('SET LOCAL TRANSACTION READ ONLY');
  const timeout = typeof options.timeout === 'number' ? `${options.timeout}ms` : options.timeout;
  await run(`SET LOCAL statement_timeout = '${timeout}'`);
  if (options.idleTimeout) {
    await run(`SET LOCAL idle_in_transaction_session_timeout = '${timeout}'`);
  }
  if (await isDbReadonlyRoleAvailable()) {
    await run(`SET LOCAL ROLE ${DB_READONLY_ROLE}`);
  }
}
