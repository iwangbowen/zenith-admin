import { eq, and, isNull, type SQL } from 'drizzle-orm';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { smsConfigs } from '../../db/schema';
import type { SmsConfigRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { clearDefaultFlag, ensureSingleDefault } from '../../lib/default-flag';
import { currentUserOrNull } from '../../lib/context';
import { config } from '../../config';
import type { CreateSmsConfigInput, UpdateSmsConfigInput, SmsProvider } from '@zenith/shared/messaging';
import { maskSecret, SECRET_PLACEHOLDER } from '@zenith/shared/core';

/** 列表返回脱敏 */
export function mapSmsConfigSafe(row: SmsConfigRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    accessKeyId: row.accessKeyId ? maskSecret(row.accessKeyId, { filler: SECRET_PLACEHOLDER }) : '',
    region: row.region ?? null,
    signName: row.signName ?? '',
    isDefault: row.isDefault,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 编辑详情：accessKeySecret 不返回原文 */
export function mapSmsConfigForEdit(row: SmsConfigRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    accessKeyId: row.accessKeyId,
    accessKeySecret: '', // 留空，前端不传则后端保持原值
    region: row.region ?? null,
    signName: row.signName ?? '',
    isDefault: row.isDefault,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSmsConfigExists(id: number) {
  return requireFirstRow(
    db.select().from(smsConfigs).where(and(eq(smsConfigs.id, id), tenantScope(smsConfigs))).limit(1),
    '短信配置不存在',
  );
}

/** 默认标记的归属范围：同租户内至多一个默认（平台视角无租户条件即全局） */
function defaultScope(): SQL {
  return and(eq(smsConfigs.isDefault, true), tenantScope(smsConfigs)) ?? eq(smsConfigs.isDefault, true);
}

export interface ListSmsConfigsQuery {
  keyword?: string;
  provider?: SmsProvider;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listSmsConfigs(q: ListSmsConfigsQuery) {
  const conditions: (SQL | undefined)[] = [tenantScope(smsConfigs), keywordCondition(q.keyword, [smsConfigs.name, smsConfigs.signName], 'ilike')];
  if (q.provider) conditions.push(eq(smsConfigs.provider, q.provider));
  if (q.status) conditions.push(eq(smsConfigs.status, q.status));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(smsConfigs, where),
    rows: () => withPagination(db.select().from(smsConfigs).where(where).orderBy(smsConfigs.id).$dynamic(), q.page, q.pageSize),
    map: mapSmsConfigSafe,
  });
}

export async function getSmsConfig(id: number) {
  return mapSmsConfigForEdit(await ensureSmsConfigExists(id));
}

export async function getSmsConfigBeforeAudit(id: number) {
  return mapSmsConfigSafe(await ensureSmsConfigExists(id));
}

export async function createSmsConfig(data: CreateSmsConfigInput) {
  return db.transaction(async (tx) => {
    const tenantId = currentCreateTenantId();
    if (data.isDefault) await clearDefaultFlag(tx, smsConfigs, defaultScope());
    const [row] = await tx.insert(smsConfigs).values({ ...data, tenantId }).returning();
    return mapSmsConfigSafe(row);
  });
}

export async function updateSmsConfig(id: number, data: UpdateSmsConfigInput) {
  const existing = await ensureSmsConfigExists(id);
  return db.transaction(async (tx) => {
    if (data.isDefault === true) await clearDefaultFlag(tx, smsConfigs, defaultScope());
    // accessKeySecret 留空表示不更新
    const patch: Partial<typeof smsConfigs.$inferInsert> = { ...data };
    if (!data.accessKeySecret) {
      delete patch.accessKeySecret;
    }
    const [row] = await tx.update(smsConfigs).set(patch).where(eq(smsConfigs.id, id)).returning();
    return mapSmsConfigSafe(row ?? existing);
  });
}

export async function deleteSmsConfig(id: number) {
  await ensureSmsConfigExists(id);
  await db.delete(smsConfigs).where(eq(smsConfigs.id, id));
}

/** 设置为默认配置（同租户内只允许一个默认） */
export async function setSmsConfigDefault(id: number) {
  const row = await ensureSmsConfigExists(id);
  await db.transaction(async (tx) => {
    await ensureSingleDefault(tx, smsConfigs, id, { scope: tenantScope(smsConfigs) });
  });
  return mapSmsConfigSafe({ ...row, isDefault: true });
}

/**
 * 获取启用的默认短信配置（运行时发送使用）。
 * 有请求用户时按其租户作用域取；匿名 / 无请求上下文（会员验证码、worker）时取平台级配置——
 * 多租户模式下即 tenantId 为空的那条，单租户模式不加租户条件。
 */
export async function findDefaultSmsConfig(): Promise<SmsConfigRow | null> {
  const scope = currentUserOrNull()
    ? tenantScope(smsConfigs)
    : (config.multiTenantMode ? isNull(smsConfigs.tenantId) : undefined);
  const [row] = await db.select().from(smsConfigs)
    .where(buildWhere(and(eq(smsConfigs.isDefault, true), eq(smsConfigs.status, 'enabled'), scope)) ?? eq(smsConfigs.isDefault, true))
    .limit(1);
  return row ?? null;
}
