/**
 * 「单一默认项」写入原语：配置类实体（短信 / 推送 / 文件存储 / 支付渠道 / 公众号 / 报表环境 / 保存视图 / 套餐…）
 * 都带 `is_default` 标记，业务要求在某个归属范围内至多一行为默认。
 *
 * 范围条件（租户 / 渠道 / 用户 + 页面 / 全表）由调用方给出，本模块只收口两步写入本身；
 * 与业务插入 / 更新放在同一事务里调用（传入 `tx`），避免并发写出双默认。
 */
import { and, eq, ne, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '../db/types';

/** 带 `id` 与 `is_default` 列的表 */
export type DefaultFlagTable = PgTable & { id: PgColumn; isDefault: PgColumn };

/**
 * 清除范围内的默认标记。
 * `where` 通常应包含 `eq(table.isDefault, true)`，否则范围内所有行都会被 UPDATE（并刷新 `updated_at`）；
 * 缺省（undefined）即全表。
 */
export async function clearDefaultFlag(executor: DbExecutor, table: DefaultFlagTable, where?: SQL): Promise<void> {
  await executor.update(table).set({ isDefault: false } as PgUpdateSetSource<DefaultFlagTable>).where(where);
}

/**
 * 范围内「仅目标行为默认」：先清除范围内其它行（`is_default = true AND id <> id AND scope`）的默认标记，
 * 再把目标行置为默认。`extra` 用于随默认一并写入的字段（如支付渠道置默认时强制 `status: 'enabled'`）。
 */
export async function ensureSingleDefault(
  executor: DbExecutor,
  table: DefaultFlagTable,
  id: number,
  options: { scope?: SQL; extra?: Record<string, unknown> } = {},
): Promise<void> {
  await clearDefaultFlag(executor, table, and(eq(table.isDefault, true), ne(table.id, id), options.scope));
  await executor
    .update(table)
    .set({ isDefault: true, ...options.extra } as PgUpdateSetSource<DefaultFlagTable>)
    .where(eq(table.id, id));
}
