import { eq, and, desc, sql } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { mpQrcodes, mpFans } from '../../db/schema';
import type { MpQrcodeRow } from '../../db/schema';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { createWechatQrcode } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreateMpQrcodeInput, mpQrcodeContract } from '@zenith/shared/mp';
import type { QueryOutputOf } from '@zenith/shared/core';

export function mapMpQrcode(row: MpQrcodeRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type,
    sceneStr: row.sceneStr,
    name: row.name,
    ticket: row.ticket ?? null,
    url: row.url ?? null,
    expireSeconds: row.expireSeconds ?? null,
    scanCount: row.scanCount,
    rewardPoints: row.rewardPoints,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpQrcodeExists(id: number): Promise<MpQrcodeRow> {
  const [row] = await db.select().from(mpQrcodes).where(and(eq(mpQrcodes.id, id), tenantScope(mpQrcodes))).limit(1);
  return requireRow(row, '二维码不存在');
}

export async function getMpQrcodeBeforeAudit(id: number) {
  return mapMpQrcode(await ensureMpQrcodeExists(id));
}

export async function listMpQrcodes(q: QueryOutputOf<typeof mpQrcodeContract.list>) {
  await ensureMpAccountExists(q.accountId);
  const where = buildWhere(
    eq(mpQrcodes.accountId, q.accountId),
    tenantScope(mpQrcodes),
    q.type ? eq(mpQrcodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [mpQrcodes.name, mpQrcodes.sceneStr], 'ilike'),
  );
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(mpQrcodes, where),
    rows: () => withPagination(db.select().from(mpQrcodes).where(where).orderBy(desc(mpQrcodes.id)).$dynamic(), q.page, q.pageSize),
    map: mapMpQrcode,
  });
}

/** 创建带参二维码：调微信 qrcode/create 换取 ticket，落库本地登记。 */
export async function createMpQrcode(data: CreateMpQrcodeInput) {
  const account = await ensureMpAccountExists(data.accountId);
  let result;
  try {
    result = await createWechatQrcode(account, { type: data.type, sceneStr: data.sceneStr, expireSeconds: data.expireSeconds });
  } catch (err) {
    return mapWechatError(err);
  }
  const tenantId = currentCreateTenantId();
  try {
    const [row] = await db.insert(mpQrcodes).values({
      accountId: data.accountId,
      type: data.type,
      sceneStr: data.sceneStr,
      name: data.name,
      ticket: result.ticket,
      url: result.url,
      expireSeconds: result.expireSeconds,
      scanCount: 0,
      rewardPoints: data.rewardPoints ?? 0,
      tenantId,
    }).returning();
    return mapMpQrcode(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该场景值已存在');
  }
}

export async function deleteMpQrcode(id: number) {
  await ensureMpQrcodeExists(id);
  await db.delete(mpQrcodes).where(eq(mpQrcodes.id, id));
}

/** 扫码计数（由公开回调调用，无登录上下文，按 accountId + sceneStr 累加）。 */
export async function incrementQrcodeScan(accountId: number, sceneStr: string): Promise<void> {
  if (!sceneStr) return;
  await db.update(mpQrcodes)
    .set({ scanCount: sql`${mpQrcodes.scanCount} + 1` })
    .where(and(eq(mpQrcodes.accountId, accountId), eq(mpQrcodes.sceneStr, sceneStr)));
}

/**
 * 扫码关注奖励积分（公开回调调用，无登录上下文）。
 * 若该带参二维码配置了 rewardPoints 且扫码粉丝已绑定会员，则为会员入账积分。最佳努力，失败仅告警。
 */
export async function rewardScanPoints(accountId: number, sceneStr: string, openid: string): Promise<void> {
  if (!sceneStr || !openid) return;
  const [qr] = await db.select({ rewardPoints: mpQrcodes.rewardPoints }).from(mpQrcodes)
    .where(and(eq(mpQrcodes.accountId, accountId), eq(mpQrcodes.sceneStr, sceneStr))).limit(1);
  if (!qr || qr.rewardPoints <= 0) return;
  const [fan] = await db.select({ memberId: mpFans.memberId }).from(mpFans)
    .where(and(eq(mpFans.accountId, accountId), eq(mpFans.openid, openid))).limit(1);
  if (!fan?.memberId) return;
  const { changePoints } = await import('../member/member-points.service');
  await changePoints({ memberId: fan.memberId, type: 'earn', amount: qr.rewardPoints, bizType: 'mp_scan_reward', bizId: sceneStr, remark: '公众号扫码关注奖励' });
}
