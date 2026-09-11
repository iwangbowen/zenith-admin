import { eq, and } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { mpKfAccounts } from '../../db/schema';
import type { MpKfAccountRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { getWechatKfList, addWechatKfAccount, updateWechatKfAccount, delWechatKfAccount } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateMpKfAccountInput, UpdateMpKfAccountInput, mpKfAccountContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpKfAccount(row: MpKfAccountRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    kfAccount: row.kfAccount,
    nickname: row.nickname,
    avatar: row.avatar ?? null,
    kfId: row.kfId ?? null,
    inviteStatus: row.inviteStatus,
    inviteWx: row.inviteWx ?? null,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpKfAccountExists(id: number): Promise<MpKfAccountRow> {
  const [row] = await db.select().from(mpKfAccounts).where(and(eq(mpKfAccounts.id, id), tenantScope(mpKfAccounts))).limit(1);
  return requireRow(row, '客服账号不存在');
}

export async function getMpKfAccountBeforeAudit(id: number) {
  return mapMpKfAccount(await ensureMpKfAccountExists(id));
}

export async function listMpKfAccounts(q: QueryOutputOf<typeof mpKfAccountContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpKfAccounts.accountId, q.accountId),
    tenantScope(mpKfAccounts),
    keywordCondition(q.keyword, [mpKfAccounts.nickname], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpKfAccounts, where),
    rows: () => withPagination(db.select().from(mpKfAccounts).where(where).orderBy(mpKfAccounts.id).$dynamic(), q.page, q.pageSize),
    map: mapMpKfAccount,
  });
}

/** 创建客服账号：调微信 kfaccount/add，成功后登记本地。 */
export async function createMpKfAccount(data: CreateMpKfAccountInput) {
  const account = await ensureMpAccountExists(data.accountId);
  try {
    await addWechatKfAccount(account, data.kfAccount, data.nickname);
  } catch (err) {
    return mapWechatError(err);
  }
  const tenantId = currentCreateTenantId();
  try {
    const [row] = await db.insert(mpKfAccounts).values({
      accountId: data.accountId, kfAccount: data.kfAccount, nickname: data.nickname, tenantId,
    }).returning();
    return mapMpKfAccount(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该客服账号已存在');
  }
}

/** 修改客服昵称：调微信 kfaccount/update，成功后更新本地。 */
export async function updateMpKfAccount(id: number, data: UpdateMpKfAccountInput) {
  const existing = await ensureMpKfAccountExists(id);
  const account = await ensureMpAccountExists(existing.accountId);
  try {
    await updateWechatKfAccount(account, existing.kfAccount, data.nickname);
  } catch (err) {
    return mapWechatError(err);
  }
  const [row] = await db.update(mpKfAccounts).set({ nickname: data.nickname }).where(eq(mpKfAccounts.id, id)).returning();
  return mapMpKfAccount(row);
}

/** 删除客服账号：调微信 kfaccount/del，成功后删除本地。 */
export async function deleteMpKfAccount(id: number) {
  const existing = await ensureMpKfAccountExists(id);
  const account = await ensureMpAccountExists(existing.accountId);
  try {
    await delWechatKfAccount(account, existing.kfAccount);
  } catch (err) {
    return mapWechatError(err);
  }
  await db.delete(mpKfAccounts).where(eq(mpKfAccounts.id, id));
}

/** 从微信同步客服账号（按 kf_account upsert）。 */
export async function syncMpKfAccounts(accountId: number): Promise<{ success: boolean; created: number; updated: number; total: number }> {
  const account = await ensureMpAccountExists(accountId);
  let kfList;
  try {
    kfList = await getWechatKfList(account);
  } catch (err) {
    return mapWechatError(err);
  }
  const tenantId = currentCreateTenantId();
  let created = 0;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const kf of kfList) {
      const [existing] = await tx.select({ id: mpKfAccounts.id }).from(mpKfAccounts)
        .where(and(eq(mpKfAccounts.accountId, accountId), eq(mpKfAccounts.kfAccount, kf.kf_account))).limit(1);
      const patch = { nickname: kf.kf_nick, avatar: kf.kf_headimgurl ?? null, kfId: kf.kf_id ?? null, inviteStatus: kf.invite_status ?? 'none', inviteWx: kf.invite_wx ?? null };
      if (existing) {
        await tx.update(mpKfAccounts).set(patch).where(eq(mpKfAccounts.id, existing.id));
        updated += 1;
      } else {
        await tx.insert(mpKfAccounts).values({ accountId, kfAccount: kf.kf_account, ...patch, tenantId });
        created += 1;
      }
    }
  });
  return { success: true, created, updated, total: kfList.length };
}
