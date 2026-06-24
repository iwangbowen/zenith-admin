import { eq, and, ilike, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpMaterials } from '../db/schema';
import type { MpMaterialRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { batchGetWechatMaterials, deleteWechatMaterial, uploadWechatMaterial } from '../lib/wechat';
import { mapWechatError } from '../lib/wechat-error';
import logger from '../lib/logger';
import type { CreateMpMaterialInput, UpdateMpMaterialInput, MpMaterialType } from '@zenith/shared';

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
  if (!row) throw new HTTPException(404, { message: '素材不存在' });
  return row;
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
  const conditions: SQL[] = [eq(mpMaterials.accountId, q.accountId)];
  const tenant = tenantScope(mpMaterials);
  if (tenant) conditions.push(tenant);
  if (q.type) conditions.push(eq(mpMaterials.type, q.type));
  if (q.keyword) conditions.push(ilike(mpMaterials.name, `%${escapeLike(q.keyword)}%`));
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(mpMaterials, where),
    withPagination(db.select().from(mpMaterials).where(where).orderBy(mpMaterials.id).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapMpMaterial), total, page: q.page, pageSize: q.pageSize };
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
        for (const item of items) {
          total += 1;
          const [existing] = await db.select({ id: mpMaterials.id }).from(mpMaterials)
            .where(and(eq(mpMaterials.accountId, accountId), eq(mpMaterials.wechatMediaId, item.media_id))).limit(1);
          if (existing) {
            await db.update(mpMaterials).set({ name: item.name || '未命名素材', url: item.url ?? null }).where(eq(mpMaterials.id, existing.id));
            updated += 1;
          } else {
            await db.insert(mpMaterials).values({ accountId, type, name: item.name || '未命名素材', wechatMediaId: item.media_id, url: item.url ?? null, tenantId });
            created += 1;
          }
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
