import { eq, like, and, ne, desc } from 'drizzle-orm';
import { mergeWhere, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import { systemConfigs } from '../db/schema';
import { streamToExcel } from '../lib/excel-export';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';

type ConfigType = 'string' | 'number' | 'boolean' | 'json';

export function mapConfig(row: typeof systemConfigs.$inferSelect) {
  return { ...row, createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt) };
}

export async function getPublicConfig(key: string) {
  const [row] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, key)).limit(1);
  if (!row) throw new HTTPException(404, { message: '配置不存在' });
  return { configKey: row.configKey, configValue: row.configValue, configType: row.configType };
}

export interface ListSystemConfigsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  configType?: ConfigType;
}

export async function listSystemConfigs(q: ListSystemConfigsQuery) {
  const user = currentUser();
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const conditions = [];
  if (q.keyword) conditions.push(like(systemConfigs.configKey, `%${q.keyword}%`));
  if (q.configType) conditions.push(eq(systemConfigs.configType, q.configType));
  const where = and(...conditions);
  const tc = tenantCondition(systemConfigs, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, rows] = await Promise.all([
    db.$count(systemConfigs, finalWhere),
    withPagination(db.select().from(systemConfigs).where(finalWhere).orderBy(desc(systemConfigs.id)).$dynamic(), page, pageSize),
  ]);
  return { list: rows.map(mapConfig), total, page, pageSize };
}

export interface SystemConfigInput {
  configKey: string;
  configValue: string;
  configType: ConfigType;
  description?: string;
}

export async function createSystemConfig(data: SystemConfigInput) {
  const user = currentUser();
  const tc = tenantCondition(systemConfigs, user);
  const conditions = [eq(systemConfigs.configKey, data.configKey)];
  if (tc) conditions.push(tc);
  const [existing] = await db
    .select()
    .from(systemConfigs)
    .where(and(...conditions))
    .limit(1);
  if (existing) throw new HTTPException(400, { message: '配置键已存在' });
  const [row] = await db.insert(systemConfigs).values({ ...data, tenantId: getCreateTenantId(user) }).returning();
  return mapConfig(row);
}

export async function updateSystemConfig(id: number, data: Partial<SystemConfigInput>) {
  const user = currentUser();
  if (data.configKey) {
    const tc = tenantCondition(systemConfigs, user);
    const dupWhere = tc
      ? and(eq(systemConfigs.configKey, data.configKey), ne(systemConfigs.id, id), tc)
      : and(eq(systemConfigs.configKey, data.configKey), ne(systemConfigs.id, id));
    const [dup] = await db.select().from(systemConfigs).where(dupWhere).limit(1);
    if (dup) throw new HTTPException(400, { message: '配置键已存在' });
  }
  const tenantCond = tenantCondition(systemConfigs, user);
  const [row] = await db
    .update(systemConfigs)
    .set({ ...data })
    .where(tenantCond ? and(eq(systemConfigs.id, id), tenantCond) : eq(systemConfigs.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: '配置不存在' });
  return mapConfig(row);
}

export async function deleteSystemConfig(id: number) {
  const user = currentUser();
  const tc = tenantCondition(systemConfigs, user);
  const [row] = await db
    .delete(systemConfigs)
    .where(tc ? and(eq(systemConfigs.id, id), tc) : eq(systemConfigs.id, id))
    .returning();
  if (!row) throw new HTTPException(404, { message: '配置不存在' });
}

export async function getSystemConfig(id: number) {
  const user = currentUser();
  const tc = tenantCondition(systemConfigs, user);
  const [row] = await db.select().from(systemConfigs).where(tc ? and(eq(systemConfigs.id, id), tc) : eq(systemConfigs.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '配置不存在' });
  return mapConfig(row);
}

export async function getSystemConfigBeforeAudit(id: number) {
  const user = currentUser();
  const tc = tenantCondition(systemConfigs, user);
  const [row] = await db.select().from(systemConfigs).where(tc ? and(eq(systemConfigs.id, id), tc) : eq(systemConfigs.id, id)).limit(1);
  if (!row) return null;
  return mapConfig(row);
}

export async function exportSystemConfigs(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(systemConfigs).where(tenantCondition(systemConfigs, user)).orderBy(desc(systemConfigs.id));
  const stream = await streamToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '配置键', key: 'configKey', width: 30 },
      { header: '配置值', key: 'configValue', width: 40 },
      { header: '类型', key: 'configType', width: 10 },
      { header: '描述', key: 'description', width: 30 },
    ],
    rows.map(mapConfig),
    '系统配置',
  );
  return { stream, filename: 'system-configs.xlsx' };
}
