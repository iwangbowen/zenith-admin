/**
 * 导出定义的常用预设：多个定义反复书写的留存策略、状态枚举映射与「租户可见范围内整表导出」数据源。
 * 只是把重复的字面量收口到一处，不改变任何导出的行为；与默认值不同的策略仍在各定义里显式书写。
 */
import type { SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { COMMON_STATUS_LABELS } from '@zenith/shared/core';
import { db } from '../../db';
import { currentUser } from '../context';
import { tenantCondition } from '../tenant';
import type { ExportRetentionPolicy } from './types';

/** 一周留存：普通 / 敏感 / 原始文件同期（基础资料与运营日志类导出的通用口径） */
export const RETENTION_7_DAYS: ExportRetentionPolicy = { normalDays: 7, sensitiveDays: 7, rawDays: 7 };

/** 启用 / 禁用状态列的 `enumMap` */
export const STATUS_ENUM_MAP: Record<string, string> = COMMON_STATUS_LABELS;

/**
 * 租户可见范围内的整表导出数据源：count 与 rows 使用同一个 `tenantCondition`，
 * 供岗位 / 角色 / 字典 / 公告等基础资料导出直接展开：`...tenantScopedTableSource(roles, asc(roles.id))`。
 */
export function tenantScopedTableSource<T extends PgTable & { tenantId: PgColumn }>(table: T, orderBy: SQL | PgColumn) {
  // drizzle 对泛型表的 from() 做了条件类型守卫，这里按基类表型选择即可（导出行本就是 Record<string, unknown>）
  const source: PgTable = table;
  return {
    countRows: async () => db.$count(table, tenantCondition(table, currentUser())),
    streamRows: async () => db.select().from(source).where(tenantCondition(table, currentUser())).orderBy(orderBy),
  };
}
