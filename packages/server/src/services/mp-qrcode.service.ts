import { eq, and, or, ilike, desc, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { mpQrcodes } from '../db/schema';
import type { MpQrcodeRow } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { ensureMpAccountExists } from './mp-account.service';
import { createWechatQrcode } from '../lib/wechat';
import { mapWechatError } from '../lib/wechat-error';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { CreateMpQrcodeInput, MpQrcodeType } from '@zenith/shared';

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
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureMpQrcodeExists(id: number): Promise<MpQrcodeRow> {
  const [row] = await db.select().from(mpQrcodes).where(and(eq(mpQrcodes.id, id), tenantScope(mpQrcodes))).limit(1);
  if (!row) throw new HTTPException(404, { message: '二维码不存在' });
  return row;
}

export async function getMpQrcodeBeforeAudit(id: number) {
  return mapMpQrcode(await ensureMpQrcodeExists(id));
}

export interface ListMpQrcodesQuery {
  accountId: number;
  type?: MpQrcodeType;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listMpQrcodes(q: ListMpQrcodesQuery) {
  await ensureMpAccountExists(q.accountId);
  const conditions: SQL[] = [eq(mpQrcodes.accountId, q.accountId)];
  const tenant = tenantScope(mpQrcodes);
  if (tenant) conditions.push(tenant);
  if (q.type) conditions.push(eq(mpQrcodes.type, q.type));
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    const matched = or(ilike(mpQrcodes.name, kw), ilike(mpQrcodes.sceneStr, kw));
    if (matched) conditions.push(matched);
  }
  const where = mergeWhere(and(...conditions));
  const [total, list] = await Promise.all([
    db.$count(mpQrcodes, where),
    withPagination(db.select().from(mpQrcodes).where(where).orderBy(desc(mpQrcodes.id)).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: list.map(mapMpQrcode), total, page: q.page, pageSize: q.pageSize };
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
