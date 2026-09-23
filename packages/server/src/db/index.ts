import { drizzle } from 'drizzle-orm/postgres-js';
import type { Logger } from 'drizzle-orm/logger';
import postgres from 'postgres';
import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config';
import logger from '../lib/logger';
import { currentAuditUserId } from '../lib/audit-context';
import type { DbTransaction } from './types';
import * as schema from './schema';

class DrizzleLogger implements Logger {
  logQuery(query: string, params: unknown[]): void {
    logger.debug('SQL', { query, params });
  }
}

const client = postgres(config.databaseUrl, {
  max: config.database.maxConnections,
  idle_timeout: config.database.idleTimeoutSeconds,
  connect_timeout: config.database.connectTimeoutSeconds,
  ssl: config.database.ssl,
});

const rawDb = drizzle(client, {
  schema,
  casing: 'snake_case',
  logger: config.log.level === 'debug' ? new DrizzleLogger() : false,
});

// ─── 审计字段自动注入 ──────────────────────────────────────────────────────────
// 通过 Proxy 拦截 db.insert(table).values() / db.update(table).set()，
// 当 table 拥有 createdBy/updatedBy 列且当前存在审计上下文用户（请求登录用户或
// runAsUser 覆盖）时，自动写入对应列。业务 service 无需手动赋值。
function tableHasAudit(table: unknown): boolean {
  const t = table as Record<string, unknown> | null;
  return !!t && t['createdBy'] !== undefined && t['updatedBy'] !== undefined;
}

function injectOnCreate(table: unknown, data: unknown): unknown {
  if (!tableHasAudit(table)) return data;
  const userId = currentAuditUserId();
  if (userId == null) return data;
  const patch = { createdBy: userId, updatedBy: userId };
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...patch, ...(row as object) }));
  }
  return { ...patch, ...(data as object) };
}

function injectOnUpdate(table: unknown, data: unknown): unknown {
  if (!tableHasAudit(table)) return data;
  const userId = currentAuditUserId();
  if (userId == null) return data;
  return { updatedBy: userId, ...(data as object) };
}

type AnyBuilder = { values?: (...args: unknown[]) => unknown; set?: (...args: unknown[]) => unknown; onConflictDoUpdate?: (...args: unknown[]) => unknown };

function wrapInsertReturn(insert: AnyBuilder, table: unknown): AnyBuilder {
  // 同时拦截 .onConflictDoUpdate({ set })：冲突时也注入 updated_by
  const origOnConflict = insert.onConflictDoUpdate?.bind(insert);
  if (origOnConflict) {
    insert.onConflictDoUpdate = (...args: unknown[]) => {
      const cfg = args[0] as { set?: unknown; [k: string]: unknown };
      const next = cfg && typeof cfg === 'object' ? { ...cfg, set: injectOnUpdate(table, cfg.set ?? {}) } : cfg;
      return origOnConflict(next);
    };
  }
  return insert;
}

function wrapInsertBuilder(builder: AnyBuilder, table: unknown): AnyBuilder {
  const orig = builder.values?.bind(builder);
  if (!orig) return builder;
  builder.values = (data: unknown) => wrapInsertReturn(orig(injectOnCreate(table, data)) as AnyBuilder, table);
  return builder;
}

function wrapUpdateBuilder(builder: AnyBuilder, table: unknown): AnyBuilder {
  const orig = builder.set?.bind(builder);
  if (!orig) return builder;
  builder.set = (data: unknown) => orig(injectOnUpdate(table, data));
  return builder;
}

function wrapExecutor<T extends object>(executor: T): T {
  return new Proxy(executor, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === 'insert' && typeof value === 'function') {
        return (table: unknown) => wrapInsertBuilder(value.call(target, table), table);
      }
      if (prop === 'update' && typeof value === 'function') {
        return (table: unknown) => wrapUpdateBuilder(value.call(target, table), table);
      }
      if (prop === 'transaction' && typeof value === 'function') {
        return (cb: (tx: object) => unknown, ...rest: unknown[]) =>
          value.call(target, (tx: object) => cb(wrapExecutor(tx)), ...rest);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** 仅供单元测试验证审计注入行为，业务代码禁止直接调用。 */
export { wrapExecutor as wrapExecutorForTest };

const executorScope = new AsyncLocalStorage<DbTransaction>();
const auditedDb = wrapExecutor(rawDb);

/** Explicit transaction scope for CMS generation rendering. It never changes other requests. */
export function withDbExecutor<T>(executor: DbTransaction, fn: () => Promise<T>): Promise<T> {
  return executorScope.run(executor, fn);
}
/** Runtime writes such as telemetry must not inherit a read-only publication transaction. */
export function withoutDbExecutor<T>(fn: () => T): T { return executorScope.exit(fn); }

export const db = new Proxy(auditedDb, {
  get(target, property, receiver) {
    const scoped = executorScope.getStore();
    const owner = scoped ?? target;
    const value = Reflect.get(owner, property, scoped ? owner : receiver);
    return typeof value === 'function' ? value.bind(owner) : value;
  },
});

/**
 * 只读一致性快照事务（repeatable read + read only）。
 * 用于「多条查询必须来自同一数据快照」的统计 / 对账 / 汇总场景。
 * 注意：事务内语句在同一连接上串行执行，Promise.all 不再并行；
 * 普通分页列表的 count + rows 不要使用本函数，保持并行查询即可。
 */
export function readSnapshot<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}

/** 底层 postgres-js 客户端。仅供需要原生能力（如 cursor 流式读取）的场景使用。 */
export const pgClient = client;

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
