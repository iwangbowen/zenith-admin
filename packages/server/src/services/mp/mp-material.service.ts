import { eq, and, inArray, sql, type SQL } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { mpMaterials } from '../../db/schema';
import type { MpMaterialRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { batchGetWechatMaterials, deleteWechatMaterial, uploadWechatMaterial } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import logger from '../../lib/logger';
import type { CreateMpMaterialInput, UpdateMpMaterialInput, MpMaterialType } from '@zenith/shared/mp';

export function mapMpMaterial(row: MpMaterialRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type,
    name: row.name,
    wechatMediaId: row.wechatMediaId ?? null,
    url: row.url ?? null,
    fileSize: row.fileSize ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpMaterialExists(id: number): Promise<MpMaterialRow> {
  const [row] = await db.select().from(mpMaterials).where(and(eq(mpMaterials.id, id), tenantScope(mpMaterials))).limit(1);
  return requireRow(row, '素材不存在');
}

export async function getMpMaterialBeforeAudit(id: number) {
  return mapMpMaterial(await ensureMpMaterialExists(id));
}

export interface ListMpMaterialsQuery {
  accountId: number;
  type?: MpMaterialType;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listMpMaterials(q: ListMpMaterialsQuery) {
  await ensureMpAccountExists(q.accountId);
  const conditions: (SQL | undefined)[] = [eq(mpMaterials.accountId, q.accountId)];
  const tenant = tenantScope(mpMaterials);
  if (tenant) conditions.push(tenant);
  if (q.type) conditions.push(eq(mpMaterials.type, q.type));
  conditions.push(keywordCondition(q.keyword, [mpMaterials.name], 'ilike'));
  const where = buildWhere(...conditions);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpMaterials, where),
    rows: () => withPagination(db.select().from(mpMaterials).where(where).orderBy(mpMaterials.id).$dynamic(), q.page, q.pageSize),
    map: mapMpMaterial,
  });
}

export async function createMpMaterial(data: CreateMpMaterialInput) {
  await ensureMpAccountExists(data.accountId);
  const tenantId = currentCreateTenantId();
  const [row] = await db.insert(mpMaterials).values({ ...data, tenantId }).returning();
  return mapMpMaterial(row);
}

export async function updateMpMaterial(id: number, data: UpdateMpMaterialInput) {
  await ensureMpMaterialExists(id);
  const [row] = await db.update(mpMaterials).set({ name: data.name }).where(eq(mpMaterials.id, id)).returning();
  return mapMpMaterial(row);
}

export async function deleteMpMaterial(id: number) {
  const row = await ensureMpMaterialExists(id);
  // 尽力删除微信端永久素材（失败不阻塞本地删除）
  if (row.wechatMediaId) {
    try {
      const account = await ensureMpAccountExists(row.accountId);
      await deleteWechatMaterial(account, row.wechatMediaId);
    } catch (err) {
      logger.warn(`[mp-material] 微信端素材删除失败（已忽略）: ${(err as Error).message}`);
    }
  }
  await db.delete(mpMaterials).where(eq(mpMaterials.id, id));
}

/** 上传二进制素材到微信永久素材库，并登记本地。 */
export async function uploadMpMaterial(
  accountId: number,
  type: MpMaterialType,
  file: Blob,
  filename: string,
  name: string,
  videoMeta?: { title: string; introduction: string },
) {
  const account = await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();
  let result;
  try {
    result = await uploadWechatMaterial(account, type, file, filename, videoMeta);
  } catch (err) {
    return mapWechatError(err);
  }
  const [row] = await db.insert(mpMaterials).values({
    accountId,
    type,
    name: name || filename,
    wechatMediaId: result.mediaId,
    url: result.url,
    fileSize: file.size,
    tenantId,
  }).returning();
  return mapMpMaterial(row);
}
export async function syncMpMaterials(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  const tenantId = currentCreateTenantId();
  const types = ['image', 'voice', 'video'] as const;
  const PAGE = 20;
  let created = 0;
  let updated = 0;
  let total = 0;
  try {
    for (const type of types) {
      let offset = 0;
      for (;;) {
        const { total: typeTotal, items } = await batchGetWechatMaterials(account, type, offset, PAGE);
        total += items.length;
        // 页内按 media_id 去重，避免同一批 upsert 两次命中同一行
        const uniqueItems = [...new Map(items.filter((i) => i.media_id).map((i) => [i.media_id, i])).values()];
        if (uniqueItems.length > 0) {
          const mediaIds = uniqueItems.map((i) => i.media_id);
          const existing = await db.select({ wechatMediaId: mpMaterials.wechatMediaId }).from(mpMaterials)
            .where(and(eq(mpMaterials.accountId, accountId), inArray(mpMaterials.wechatMediaId, mediaIds)));
          const existingSet = new Set(existing.map((r) => r.wechatMediaId));
          // 单条多行 upsert：以 (accountId, wechatMediaId) 部分唯一索引为冲突目标，替代逐条查重+写入
          await db.insert(mpMaterials)
            .values(uniqueItems.map((item) => ({
              accountId,
              type,
              name: item.name || '未命名素材',
              wechatMediaId: item.media_id,
              url: item.url ?? null,
              tenantId,
            })))
            .onConflictDoUpdate({
              target: [mpMaterials.accountId, mpMaterials.wechatMediaId],
              targetWhere: sql`${mpMaterials.wechatMediaId} is not null`,
              set: { name: sql`excluded.name`, url: sql`excluded.url` },
            });
          const newCount = mediaIds.filter((id) => !existingSet.has(id)).length;
          created += newCount;
          updated += mediaIds.length - newCount;
        }
        offset += items.length;
        if (items.length < PAGE || offset >= typeTotal) break;
      }
    }
  } catch (err) {
    mapWechatError(err);
  }
  return { success: true, created, updated, total };
}
