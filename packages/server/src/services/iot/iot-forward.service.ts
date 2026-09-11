import { iotForwardRuleContract } from '@zenith/shared/iot';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * IoT 数据流转：遥测/事件/告警/生命周期 → HTTP 推送目的地。
 *
 * 派发在设备接入与告警热路径上，必须 fire-and-forget：
 * 匹配用 30s 内存缓存（规则 + 分组成员集合），HTTP 投递进微任务不阻塞调用方。
 * 投递带可选 HMAC 签名（X-Iot-Signature = hex(hmac_sha256(secret, body))），
 * 出站走 ssrfProtection；每次投递落 iot_forward_logs，
 * 连续失败达 IOT_FORWARD_AUTO_DISABLE_THRESHOLD 自动停用规则。
 */
import { createHmac } from 'node:crypto';
import { and, count, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { CreateIotForwardRuleInput, IotForwardSource, UpdateIotForwardRuleInput } from '@zenith/shared/iot';
import { IOT_FORWARD_AUTO_DISABLE_THRESHOLD } from '@zenith/shared/iot';
import { db } from '../../db';
import {
  iotDeviceGroupMembers, iotDeviceGroups, iotForwardLogs, iotForwardRules, iotProducts,
  type IotForwardLogRow, type IotForwardRuleRow,
} from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { buildWhere, keywordCondition, withPagination } from '../../lib/where-helpers';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { httpPost } from '../../lib/http-client';
import { assertSafeOutboundUrl } from '../../lib/outbound-url';
import logger from '../../lib/logger';
import { TtlCache } from '../../lib/ttl-cache';

const FORWARD_TIMEOUT_MS = 10_000;

// ─── 映射与 CRUD ──────────────────────────────────────────────────────────────
export function mapIotForwardRule(
  row: IotForwardRuleRow,
  extra?: { productName?: string | null; groupName?: string | null; recentDeliveryCount?: number },
) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    productId: row.productId ?? null,
    productName: extra?.productName ?? null,
    groupId: row.groupId ?? null,
    groupName: extra?.groupName ?? null,
    url: row.url,
    hasSecret: !!row.secret,
    headers: row.headers ?? null,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    autoDisabledAt: formatNullableDateTime(row.autoDisabledAt),
    recentDeliveryCount: extra?.recentDeliveryCount ?? 0,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapIotForwardLog(row: IotForwardLogRow) {
  return {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: row.ruleName,
    source: row.source,
    deviceId: row.deviceId ?? null,
    payload: row.payload ?? {},
    status: row.status,
    responseStatus: row.responseStatus ?? null,
    errorMessage: row.errorMessage ?? null,
    durationMs: row.durationMs ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export type ListIotForwardRulesFilter = Omit<QueryOutputOf<typeof iotForwardRuleContract.list>, 'page' | 'pageSize'>;
export type ListIotForwardRulesQuery = QueryOutputOf<typeof iotForwardRuleContract.list>;

function buildRuleWhere(q: ListIotForwardRulesFilter & { id?: number }): SQL | undefined {
  return buildWhere(
    q.id !== undefined ? eq(iotForwardRules.id, q.id) : undefined,
    keywordCondition(q.keyword, [iotForwardRules.name]),
    q.source ? eq(iotForwardRules.source, q.source) : undefined,
    q.status ? eq(iotForwardRules.status, q.status) : undefined,
    tenantCondition(iotForwardRules, currentUser()),
  );
}

export async function listIotForwardRules(q: ListIotForwardRulesQuery) {
  const { page, pageSize } = q;
  const where = buildRuleWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(iotForwardRules, where),
    rows: async () => {
      const rows = await withPagination(
        db.select({ rule: iotForwardRules, productName: iotProducts.name, groupName: iotDeviceGroups.name })
          .from(iotForwardRules)
          .leftJoin(iotProducts, eq(iotForwardRules.productId, iotProducts.id))
          .leftJoin(iotDeviceGroups, eq(iotForwardRules.groupId, iotDeviceGroups.id))
          .where(where)
          .orderBy(desc(iotForwardRules.id))
          .$dynamic(),
        page,
        pageSize,
      );
      const ids = rows.map((r) => r.rule.id);
      const since = new Date(Date.now() - 24 * 3600_000);
      const deliveryCounts = ids.length > 0
        ? await db.select({ ruleId: iotForwardLogs.ruleId, cnt: count() })
          .from(iotForwardLogs)
          .where(and(inArray(iotForwardLogs.ruleId, ids), gte(iotForwardLogs.createdAt, since)))
          .groupBy(iotForwardLogs.ruleId)
        : [];
      const countMap = new Map(deliveryCounts.map((r) => [r.ruleId, Number(r.cnt)]));
      return rows.map((r) => mapIotForwardRule(r.rule, {
        productName: r.productName,
        groupName: r.groupName,
        recentDeliveryCount: countMap.get(r.rule.id) ?? 0,
      }));
    },
  });
}

export async function ensureIotForwardRuleExists(id: number): Promise<IotForwardRuleRow> {
  const [row] = await db.select().from(iotForwardRules).where(buildRuleWhere({ id })).limit(1);
  return requireRow(row, '流转规则不存在');
}

export async function createIotForwardRule(data: CreateIotForwardRuleInput) {
  await assertSafeOutboundUrl(data.url);
  const [row] = await db.insert(iotForwardRules).values({
    name: data.name,
    source: data.source,
    productId: data.productId ?? null,
    groupId: data.groupId ?? null,
    url: data.url,
    secret: data.secret ?? null,
    headers: data.headers ?? null,
    status: data.status,
    tenantId: getCreateTenantId(currentUser()),
  }).returning();
  invalidateForwardCache();
  return mapIotForwardRule(row);
}

export async function updateIotForwardRule(id: number, data: UpdateIotForwardRuleInput) {
  await ensureIotForwardRuleExists(id);
  if (data.url !== undefined) await assertSafeOutboundUrl(data.url);
  const [row] = await db.update(iotForwardRules).set({
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.productId !== undefined ? { productId: data.productId } : {}),
    ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
    ...(data.url !== undefined ? { url: data.url } : {}),
    ...(data.secret !== undefined ? { secret: data.secret } : {}),
    ...(data.headers !== undefined ? { headers: data.headers } : {}),
    // 手动启停时清零失败计数与自动停用标记
    ...(data.status !== undefined ? { status: data.status, consecutiveFailures: 0, autoDisabledAt: null } : {}),
  }).where(buildRuleWhere({ id })).returning();
  const updated = requireRow(row, '流转规则不存在');
  invalidateForwardCache();
  return mapIotForwardRule(updated);
}

export async function deleteIotForwardRule(id: number): Promise<void> {
  await ensureIotForwardRuleExists(id);
  await db.delete(iotForwardRules).where(buildRuleWhere({ id }));
  invalidateForwardCache();
}

export type ListForwardLogsFilter = Omit<QueryOutputOf<typeof iotForwardRuleContract.logs>, 'page' | 'pageSize'>;
export type ListForwardLogsQuery = QueryOutputOf<typeof iotForwardRuleContract.logs>;

export async function listIotForwardLogs(q: ListForwardLogsQuery) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.ruleId ? eq(iotForwardLogs.ruleId, q.ruleId) : undefined,
    q.status ? eq(iotForwardLogs.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db.select({ value: count() }).from(iotForwardLogs).where(where);
      return Number(row?.value ?? 0);
    },
    rows: () => withPagination(
      db.select().from(iotForwardLogs).where(where).orderBy(desc(iotForwardLogs.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapIotForwardLog,
  });
}

// ─── 运行时派发 ───────────────────────────────────────────────────────────────
const FORWARD_CACHE_TTL_MS = 30_000;

interface ForwardCache {
  rulesBySource: Map<IotForwardSource, IotForwardRuleRow[]>;
  /** groupId → 成员 deviceId 集合（仅缓存被启用规则引用的分组） */
  groupMembers: Map<number, Set<number>>;
}

/** 全局单键缓存：单飞防击穿，规则写操作即失效 */
const forwardCache = new TtlCache<'rules', ForwardCache>(FORWARD_CACHE_TTL_MS);

function invalidateForwardCache(): void {
  forwardCache.clear();
}

function loadForwardCache(): Promise<ForwardCache> {
  return forwardCache.get('rules', async () => {
    const rules = await db.select().from(iotForwardRules).where(eq(iotForwardRules.status, 'enabled'));
    const rulesBySource = new Map<IotForwardSource, IotForwardRuleRow[]>();
    for (const rule of rules) {
      const list = rulesBySource.get(rule.source) ?? [];
      list.push(rule);
      rulesBySource.set(rule.source, list);
    }
    const groupIds = [...new Set(rules.map((r) => r.groupId).filter((v): v is number => v != null))];
    const memberRows = groupIds.length > 0
      ? await db.select({ groupId: iotDeviceGroupMembers.groupId, deviceId: iotDeviceGroupMembers.deviceId })
        .from(iotDeviceGroupMembers).where(inArray(iotDeviceGroupMembers.groupId, groupIds))
      : [];
    const groupMembers = new Map<number, Set<number>>();
    for (const row of memberRows) {
      const set = groupMembers.get(row.groupId) ?? new Set<number>();
      set.add(row.deviceId);
      groupMembers.set(row.groupId, set);
    }
    return { rulesBySource, groupMembers };
  });
}

/**
 * 派发流转（fire-and-forget）：热路径只做内存匹配，HTTP 投递进微任务。
 * device 为空（如告警恢复无设备行）时跳过产品/分组过滤，仅按 source 匹配。
 */
export function dispatchIotForward(
  source: IotForwardSource,
  device: { id: number; sn: string; productId: number } | null,
  payload: Record<string, unknown>,
): void {
  loadForwardCache().then((cache) => {
    const rules = cache.rulesBySource.get(source) ?? [];
    for (const rule of rules) {
      if (device && rule.productId != null && rule.productId !== device.productId) continue;
      if (device && rule.groupId != null && !(cache.groupMembers.get(rule.groupId)?.has(device.id) ?? false)) continue;
      queueMicrotask(() => {
        void deliverForward(rule, source, device?.id ?? null, payload);
      });
    }
  }).catch((err) => {
    logger.warn(`[iot-forward] 规则缓存加载失败: ${(err as Error).message}`);
  });
}

async function deliverForward(
  rule: IotForwardRuleRow,
  source: IotForwardSource,
  deviceId: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({ source, timestamp: Date.now(), data: payload });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Iot-Source': source,
    ...(rule.headers ?? {}),
  };
  if (rule.secret) {
    headers['X-Iot-Signature'] = createHmac('sha256', rule.secret).update(body).digest('hex');
  }
  const startedAt = Date.now();
  let succeeded = false;
  let responseStatus: number | null = null;
  let errorMessage: string | null = null;
  try {
    const res = await httpPost(rule.url, body, { headers, timeout: FORWARD_TIMEOUT_MS, ssrfProtection: true });
    responseStatus = res.status;
    succeeded = res.status >= 200 && res.status < 300;
    if (!succeeded) errorMessage = `目的地返回 ${res.status}`;
  } catch (err) {
    errorMessage = (err as Error).message.slice(0, 512);
  }
  const durationMs = Date.now() - startedAt;

  try {
    await db.insert(iotForwardLogs).values({
      ruleId: rule.id,
      ruleName: rule.name,
      source,
      deviceId,
      payload,
      status: succeeded ? 'succeeded' : 'failed',
      responseStatus,
      errorMessage,
      durationMs,
    });
    if (succeeded) {
      await db.update(iotForwardRules).set({ consecutiveFailures: 0 })
        .where(eq(iotForwardRules.id, rule.id));
    } else {
      const [updated] = await db.update(iotForwardRules)
        .set({ consecutiveFailures: sql`${iotForwardRules.consecutiveFailures} + 1` })
        .where(eq(iotForwardRules.id, rule.id))
        .returning({ failures: iotForwardRules.consecutiveFailures });
      if ((updated?.failures ?? 0) >= IOT_FORWARD_AUTO_DISABLE_THRESHOLD) {
        await db.update(iotForwardRules)
          .set({ status: 'disabled', autoDisabledAt: new Date() })
          .where(eq(iotForwardRules.id, rule.id));
        invalidateForwardCache();
        logger.warn(`[iot-forward] 规则「${rule.name}」连续失败 ${updated?.failures} 次，已自动停用`);
      }
    }
  } catch (err) {
    logger.warn(`[iot-forward] 投递留痕失败 ruleId=${rule.id}: ${(err as Error).message}`);
  }
}
