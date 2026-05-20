import { eq, and, or, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { smsConfigs } from '../db/schema';
import type { SmsConfigRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import type { CreateSmsConfigInput, UpdateSmsConfigInput, SmsProvider } from '@zenith/shared';

const SECRET_MASK = '******';

/** 列表返回脱敏 */
export function mapSmsConfigSafe(row: SmsConfigRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    accessKeyId: row.accessKeyId ? `${row.accessKeyId.slice(0, 4)}${SECRET_MASK}${row.accessKeyId.slice(-4)}` : '',
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
  const [row] = await db.select().from(smsConfigs).where(and(eq(smsConfigs.id, id), tenantScope(smsConfigs))).limit(1);
  if (!row) throw new HTTPException(404, { message: '短信配置不存在' });
  return row;
}

export interface ListSmsConfigsQuery {
  keyword?: string;
  provider?: SmsProvider;
  status?: 'enabled' | 'disabled';
  page: number;
  pageSize: number;
}

export async function listSmsConfigs(q: ListSmsConfigsQuery) {
  const conditions: SQL[] = [];
  const tenant = tenantScope(smsConfigs);
  if (tenant) conditions.push(tenant);
  if (q.keyword) {
    const kw = or(ilike(smsConfigs.name, `%${escapeLike(q.keyword)}%`), ilike(smsConfigs.signName, `%${escapeLike(q.keyword)}%`));
    if (kw) conditions.push(kw);
  }
  if (q.provider) conditions.push(eq(smsConfigs.provider, q.provider));
  if (q.status) conditions.push(eq(smsConfigs.status, q.status));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(smsConfigs, where),
    withPagination(db.select().from(smsConfigs).where(where).orderBy(smsConfigs.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapSmsConfigSafe), total, page: q.page, pageSize: q.pageSize };
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
    if (data.isDefault) {
      await tx.update(smsConfigs)
        .set({ isDefault: false })
        .where(mergeWhere(and(eq(smsConfigs.isDefault, true), tenantScope(smsConfigs))) ?? eq(smsConfigs.isDefault, true));
    }
    const [row] = await tx.insert(smsConfigs).values({ ...data, tenantId }).returning();
    return mapSmsConfigSafe(row);
  });
}

export async function updateSmsConfig(id: number, data: UpdateSmsConfigInput) {
  const existing = await ensureSmsConfigExists(id);
  return db.transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.update(smsConfigs)
        .set({ isDefault: false })
        .where(mergeWhere(and(eq(smsConfigs.isDefault, true), tenantScope(smsConfigs))) ?? eq(smsConfigs.isDefault, true));
    }
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
    await tx.update(smsConfigs)
      .set({ isDefault: false })
      .where(mergeWhere(and(eq(smsConfigs.isDefault, true), tenantScope(smsConfigs))) ?? eq(smsConfigs.isDefault, true));
    await tx.update(smsConfigs).set({ isDefault: true }).where(eq(smsConfigs.id, id));
  });
  return mapSmsConfigSafe({ ...row, isDefault: true });
}

/** 获取启用的默认短信配置（运行时发送使用） */
export async function findDefaultSmsConfig(): Promise<SmsConfigRow | null> {
  const [row] = await db.select().from(smsConfigs)
    .where(mergeWhere(and(eq(smsConfigs.isDefault, true), eq(smsConfigs.status, 'enabled'), tenantScope(smsConfigs))) ?? eq(smsConfigs.isDefault, true))
    .limit(1);
  return row ?? null;
}
