import { drizzle } from 'drizzle-orm/postgres-js';
import type { Logger } from 'drizzle-orm/logger';
import postgres from 'postgres';
import { config } from '../config';
import logger from '../lib/logger';
import { currentAuditUserId } from '../lib/audit-context';
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

type AnyBuilder = { values?: Function; set?: Function; onConflictDoUpdate?: Function };

function wrapInsertReturn(insert: AnyBuilder, table: unknown): AnyBuilder {
  // 同时拦截 .onConflictDoUpdate({ set })：冲突时也注入 updated_by
  const origOnConflict = insert.onConflictDoUpdate?.bind(insert);
  if (origOnConflict) {
    insert.onConflictDoUpdate = (cfg: { set?: unknown; [k: string]: unknown }) => {
      const next = cfg && typeof cfg === 'object' ? { ...cfg, set: injectOnUpdate(table, cfg.set ?? {}) } : cfg;
      return origOnConflict(next);
    };
  }
  return insert;
}

function wrapInsertBuilder(builder: AnyBuilder, table: unknown): AnyBuilder {
  const orig = builder.values?.bind(builder);
  if (!orig) return builder;
  builder.values = (data: unknown) => wrapInsertReturn(orig(injectOnCreate(table, data)), table);
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

export const db = wrapExecutor(rawDb);

/** 底层 postgres-js 客户端。仅供需要原生能力（如 cursor 流式读取）的场景使用。 */
export const pgClient = client;

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
