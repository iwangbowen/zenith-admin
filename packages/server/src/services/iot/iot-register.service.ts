/**
 * IoT 一型一密动态注册。
 *
 * 流程：产品开启注册密钥 → 管理端预置 SN 白名单 → 设备首连以
 * HMAC-SHA256(registrationSecret, `${sn}\n${ts}\n${body}`) 签名调用
 * 设备动态注册（`iotIngestContract.register`）→ 命中未使用白名单即自动建档，
 * 返回设备专属密钥（一机一密），白名单条目一次性核销。
 * 已注册过的 SN 重复请求幂等拒绝（提示改用设备密钥接入）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { CreateIotWhitelistInput, IotRegisterDeviceInput } from '@zenith/shared/iot';
import { IOT_REGISTER_MAX_SKEW_SECONDS } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotDevices, iotDeviceState, iotDeviceWhitelist, iotProducts,
  type IotDeviceWhitelistRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import logger from '../../lib/logger';
import { generateDeviceSecret } from './iot-access.service';
import { recordIotLifecycleEvent } from './iot-events.service';

// ─── 产品注册密钥 ─────────────────────────────────────────────────────────────
/** 开启/重置动态注册密钥（明文仅本次返回，列表仅展示是否开启） */
export async function resetIotRegistrationSecret(productId: number): Promise<{ registrationSecret: string }> {
  const secret = generateDeviceSecret();
  const [row] = await db.update(iotProducts)
    .set({ registrationSecret: secret })
    .where(eq(iotProducts.id, productId))
    .returning({ id: iotProducts.id });
  if (!row) throw new HTTPException(404, { message: '产品不存在' });
  return { registrationSecret: secret };
}

/** 关闭动态注册（清空密钥；已注册设备不受影响） */
export async function disableIotRegistration(productId: number): Promise<void> {
  const [row] = await db.update(iotProducts)
    .set({ registrationSecret: null })
    .where(eq(iotProducts.id, productId))
    .returning({ id: iotProducts.id });
  if (!row) throw new HTTPException(404, { message: '产品不存在' });
}

// ─── 白名单管理 ───────────────────────────────────────────────────────────────
export function mapIotWhitelistEntry(
  row: IotDeviceWhitelistRow,
  extra?: { productName?: string | null; deviceName?: string | null },
) {
  return {
    id: row.id,
    productId: row.productId,
    productName: extra?.productName ?? null,
    sn: row.sn,
    used: row.used,
    usedAt: formatNullableDateTime(row.usedAt),
    deviceId: row.deviceId ?? null,
    deviceName: extra?.deviceName ?? null,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface ListWhitelistQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  productId?: number;
  used?: boolean;
}

function buildWhitelistWhere(q: ListWhitelistQuery & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotDeviceWhitelist.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotDeviceWhitelist.sn]),
    q.productId ? eq(iotDeviceWhitelist.productId, q.productId) : undefined,
    q.used !== undefined ? eq(iotDeviceWhitelist.used, q.used) : undefined,
    tenantCondition(iotDeviceWhitelist, currentUser()),
  );
}

export async function listIotWhitelist(q: ListWhitelistQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhitelistWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(iotDeviceWhitelist, where),
    withPagination(
      db.select({ entry: iotDeviceWhitelist, productName: iotProducts.name, deviceName: iotDevices.name })
        .from(iotDeviceWhitelist)
        .leftJoin(iotProducts, eq(iotDeviceWhitelist.productId, iotProducts.id))
        .leftJoin(iotDevices, eq(iotDeviceWhitelist.deviceId, iotDevices.id))
        .where(where)
        .orderBy(desc(iotDeviceWhitelist.id))
        .$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return {
    list: rows.map((r) => mapIotWhitelistEntry(r.entry, { productName: r.productName, deviceName: r.deviceName })),
    total,
    page,
    pageSize,
  };
}

/** 批量导入白名单（重复 SN 跳过并计数） */
export async function createIotWhitelistEntries(data: CreateIotWhitelistInput) {
  const [product] = await db.select({ id: iotProducts.id }).from(iotProducts)
    .where(eq(iotProducts.id, data.productId)).limit(1);
  if (!product) throw new HTTPException(400, { message: '产品不存在' });
  const unique = [...new Set(data.sns)];
  const inserted = await db.insert(iotDeviceWhitelist)
    .values(unique.map((sn) => ({
      productId: data.productId,
      sn,
      remark: data.remark ?? null,
      tenantId: getCreateTenantId(currentUser()),
    })))
    .onConflictDoNothing({ target: iotDeviceWhitelist.sn })
    .returning({ id: iotDeviceWhitelist.id });
  return { total: unique.length, inserted: inserted.length, skipped: unique.length - inserted.length };
}

export async function deleteIotWhitelistEntry(id: number): Promise<void> {
  const [row] = await db.select().from(iotDeviceWhitelist).where(buildWhitelistWhere({ id })).limit(1);
  if (!row) throw new HTTPException(404, { message: '白名单条目不存在' });
  if (row.used) throw new HTTPException(400, { message: '已核销的条目不可删除（保留注册追溯）' });
  await db.delete(iotDeviceWhitelist).where(eq(iotDeviceWhitelist.id, id));
}

// ─── 设备侧注册 ───────────────────────────────────────────────────────────────
function verifyRegistrationSign(secret: string, sn: string, ts: string, body: string, sign: string): boolean {
  const expected = createHmac('sha256', secret).update(`${sn}\n${ts}\n${body}`).digest('hex');
  if (expected.length !== sign.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sign));
  } catch {
    return false;
  }
}

/**
 * 设备首连注册（无管理端上下文）：验签 → 白名单核销 → 建档 → 返回设备密钥。
 * 幂等语义：SN 已注册过则 409（设备应持久化密钥，丢失需管理端重置）。
 */
export async function registerIotDevice(
  input: IotRegisterDeviceInput,
  auth: { ts: string | undefined; sign: string | undefined; rawBody: string },
) {
  if (!auth.ts || !auth.sign) throw new HTTPException(401, { message: '缺少签名参数' });
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(auth.ts));
  if (!Number.isFinite(skew) || skew > IOT_REGISTER_MAX_SKEW_SECONDS) {
    throw new HTTPException(401, { message: '签名时间戳已过期' });
  }
  const [product] = await db.select().from(iotProducts).where(eq(iotProducts.id, input.productId)).limit(1);
  if (!product) throw new HTTPException(404, { message: '产品不存在' });
  if (!product.registrationSecret) throw new HTTPException(403, { message: '该产品未开启动态注册' });
  if (product.status !== 'enabled') throw new HTTPException(403, { message: '产品已禁用' });
  if (!verifyRegistrationSign(product.registrationSecret, input.sn, auth.ts, auth.rawBody, auth.sign)) {
    throw new HTTPException(401, { message: '注册签名校验失败' });
  }

  const [existing] = await db.select({ id: iotDevices.id }).from(iotDevices)
    .where(eq(iotDevices.sn, input.sn)).limit(1);
  if (existing) throw new HTTPException(409, { message: 'SN 已注册，请使用设备密钥接入（密钥丢失需管理端重置）' });

  // 原子核销白名单（未使用 → 已使用），未命中即拒绝
  const [entry] = await db.update(iotDeviceWhitelist)
    .set({ used: true, usedAt: new Date() })
    .where(and(
      eq(iotDeviceWhitelist.sn, input.sn),
      eq(iotDeviceWhitelist.productId, input.productId),
      eq(iotDeviceWhitelist.used, false),
    ))
    .returning();
  if (!entry) throw new HTTPException(403, { message: 'SN 不在该产品的可注册白名单中' });

  const secret = generateDeviceSecret();
  const device = await db.transaction(async (tx) => {
    const [created] = await tx.insert(iotDevices).values({
      sn: input.sn,
      secret,
      productId: input.productId,
      name: input.name?.trim() || input.sn,
      firmwareVersion: input.firmwareVersion ?? null,
      remark: '动态注册',
      tenantId: entry.tenantId,
    }).returning();
    await tx.insert(iotDeviceState).values({ deviceId: created.id });
    await tx.update(iotDeviceWhitelist).set({ deviceId: created.id }).where(eq(iotDeviceWhitelist.id, entry.id));
    return created;
  });
  await recordIotLifecycleEvent(device.id, 'activated', { via: 'dynamic-registration' }).catch(() => { /* 打点失败不阻断注册 */ });
  logger.info(`[iot-register] 设备 ${input.sn} 动态注册成功（产品 #${input.productId}）`);
  return { deviceId: device.id, sn: device.sn, secret };
}

/** 白名单统计（产品维度：总数/已用，注册页顶部卡片） */
export async function getIotWhitelistStats(productId?: number) {
  const baseWhere = (extra?: SQL) => buildWhere(
    productId ? eq(iotDeviceWhitelist.productId, productId) : undefined,
    extra,
    tenantCondition(iotDeviceWhitelist, currentUser()),
  );
  const [totalRow] = await db.select({ value: count() }).from(iotDeviceWhitelist).where(baseWhere());
  const [usedRow] = await db.select({ value: count() }).from(iotDeviceWhitelist)
    .where(baseWhere(eq(iotDeviceWhitelist.used, true)));
  return { total: Number(totalRow?.value ?? 0), used: Number(usedRow?.value ?? 0) };
}
