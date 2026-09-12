import { eq, and, sql } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { mpTags } from '../../db/schema';
import type { MpTagRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatTimestamps } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { ensureMpAccountExists } from './mp-account.service';
import { getWechatTags, WechatApiError } from '../../lib/wechat';
import type { CreateMpTagInput, UpdateMpTagInput, mpTagContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpTag(row: MpTagRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    wechatTagId: row.wechatTagId ?? null,
    name: row.name,
    fansCount: row.fansCount,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureMpTagExists(id: number): Promise<MpTagRow> {
  const [row] = await db.select().from(mpTags).where(and(eq(mpTags.id, id), tenantScope(mpTags))).limit(1);
  return requireRow(row, '标签不存在');
}

export async function listMpTags(q: QueryOutputOf<typeof mpTagContract.list>) {
  await ensureMpAccountExists(q.accountId); // 校验账号归属当前租户
  const where = buildWhere(
    eq(mpTags.accountId, q.accountId),
    tenantScope(mpTags),
    keywordCondition(q.keyword, [mpTags.name], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpTags, where),
    rows: () => withPagination(db.select().from(mpTags).where(where).orderBy(mpTags.id).$dynamic(), q.page, q.pageSize),
    map: mapMpTag,
  });
}

/** 审计前快照 */
export async function getMpTagBeforeAudit(id: number) {
  return mapMpTag(await ensureMpTagExists(id));
}

export async function createMpTag(data: CreateMpTagInput) {
  await ensureMpAccountExists(data.accountId);
  try {
    const tenantId = currentCreateTenantId();
    const [row] = await db.insert(mpTags).values({ accountId: data.accountId, name: data.name, tenantId }).returning();
    return mapMpTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该标签名称已存在');
  }
}

export async function updateMpTag(id: number, data: UpdateMpTagInput) {
  await ensureMpTagExists(id);
  try {
    const [row] = await db.update(mpTags).set({ name: data.name }).where(eq(mpTags.id, id)).returning();
    return mapMpTag(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该标签名称已存在');
  }
}

export async function deleteMpTag(id: number) {
  const tag = await ensureMpTagExists(id);
  await db.transaction(async (tx) => {
    await tx.delete(mpTags).where(eq(mpTags.id, id));
    // 仅清理同一公众号下粉丝的本地标签引用（附加 account_id 过滤防止越权改动并缩小更新范围）
    await tx.execute(sql`
      UPDATE mp_fans
      SET tag_ids = COALESCE((
        SELECT jsonb_agg(elem) FROM jsonb_array_elements(tag_ids) elem WHERE elem <> to_jsonb(${id}::int)
      ), '[]'::jsonb)
      WHERE account_id = ${tag.accountId} AND tag_ids @> to_jsonb(${id}::int)
    `);
  });
}

/** 从微信同步标签到本地（按 wechatTagId / name 去重 upsert） */
export async function syncMpTags(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  let wechatTags;
  try {
    wechatTags = await getWechatTags(account);
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }
  const tenantId = currentCreateTenantId();
  let created = 0;
  let updated = 0;
  try {
    await db.transaction(async (tx) => {
      for (const wt of wechatTags) {
        const [byTagId] = await tx.select().from(mpTags)
          .where(and(eq(mpTags.accountId, accountId), eq(mpTags.wechatTagId, wt.id))).limit(1);
        if (byTagId) {
          await tx.update(mpTags).set({ name: wt.name, fansCount: wt.count }).where(eq(mpTags.id, byTagId.id));
          updated += 1;
          continue;
        }
        const [byName] = await tx.select().from(mpTags)
          .where(and(eq(mpTags.accountId, accountId), eq(mpTags.name, wt.name))).limit(1);
        if (byName) {
          await tx.update(mpTags).set({ wechatTagId: wt.id, fansCount: wt.count }).where(eq(mpTags.id, byName.id));
          updated += 1;
        } else {
          await tx.insert(mpTags).values({ accountId, wechatTagId: wt.id, name: wt.name, fansCount: wt.count, tenantId });
          created += 1;
        }
      }
    });
  } catch (err) {
    rethrowPgUniqueViolation(err, '同步失败：存在与微信侧重名的本地标签，请先处理重名标签');
  }
  return { success: true, created, updated, total: wechatTags.length };
}
