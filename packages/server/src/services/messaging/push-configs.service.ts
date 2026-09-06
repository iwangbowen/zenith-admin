/**
 * App 推送配置。
 *
 * 凭证一对一挂应用（`unique(app_id)`,供应商侧凭证本就按 App 发放）,
 * 不存在"全局默认配置"——适配器按设备所属应用取各自凭证。
 * 推送配置是平台级资源（client_apps 无租户）,不做租户隔离。
 */
import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import type { CreatePushConfigInput, PushProvider, TestPushSendInput, UpdatePushConfigInput } from '@zenith/shared/messaging';
import { db } from '../../db';
import { pushConfigs, pushSendLogs, type PushConfigRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { sendPushByProvider } from '../../lib/push-sender';
import { clearInvalidPushRegistrations } from '../ops/client-devices.service';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { maskSecret, SECRET_PLACEHOLDER } from '@zenith/shared/core';

type PushConfigWithApp = PushConfigRow & { app?: { name: string } | null };

/** 列表返回脱敏 */
export function mapPushConfigSafe(row: PushConfigWithApp) {
  return {
    id: row.id,
    appId: row.appId,
    appName: row.app?.name,
    name: row.name,
    provider: row.provider,
    appKey: row.appKey ? maskSecret(row.appKey, { filler: SECRET_PLACEHOLDER }) : '',
    apnsProduction: row.apnsProduction,
    status: row.status,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 编辑详情:masterSecret 不返回原文 */
export function mapPushConfigForEdit(row: PushConfigWithApp) {
  return {
    ...mapPushConfigSafe(row),
    appKey: row.appKey,
    masterSecret: '', // 留空,前端不传则后端保持原值
  };
}

export async function ensurePushConfigExists(id: number): Promise<PushConfigRow> {
  return requireFirstRow(
    db.select().from(pushConfigs).where(eq(pushConfigs.id, id)).limit(1),
    '推送配置不存在',
  );
}

export interface ListPushConfigsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  provider?: PushProvider;
  status?: 'enabled' | 'disabled';
}

export async function listPushConfigs(q: ListPushConfigsQuery) {
  const { page = 1, pageSize = 10 } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [pushConfigs.name, pushConfigs.remark]),
    q.provider ? eq(pushConfigs.provider, q.provider) : undefined,
    q.status ? eq(pushConfigs.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(pushConfigs, where),
    rows: () => db.query.pushConfigs.findMany({
      where,
      with: { app: { columns: { name: true } } },
      orderBy: pushConfigs.id,
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapPushConfigSafe,
  });
}

export async function getPushConfig(id: number) {
  const row = requireRow(await db.query.pushConfigs.findFirst({
    where: eq(pushConfigs.id, id),
    with: { app: { columns: { name: true } } },
  }), '推送配置不存在');
  return mapPushConfigForEdit(row);
}

export async function getPushConfigBeforeAudit(id: number) {
  return mapPushConfigSafe(await ensurePushConfigExists(id));
}

async function findPushConfigSafeById(id: number) {
  const row = requireRow(await db.query.pushConfigs.findFirst({
    where: eq(pushConfigs.id, id),
    with: { app: { columns: { name: true } } },
  }), '推送配置不存在');
  return mapPushConfigSafe(row);
}

export async function createPushConfig(data: CreatePushConfigInput) {
  try {
    const [row] = await db.insert(pushConfigs).values(data).returning();
    return findPushConfigSafeById(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用已存在推送配置(一个应用只允许一套凭证)');
    throw err;
  }
}

export async function updatePushConfig(id: number, data: UpdatePushConfigInput) {
  const existing = await ensurePushConfigExists(id);
  // masterSecret 留空表示不更新
  const patch: Partial<typeof pushConfigs.$inferInsert> = { ...data };
  if (!data.masterSecret) delete patch.masterSecret;
  try {
    await db.update(pushConfigs).set(patch).where(eq(pushConfigs.id, id));
    return findPushConfigSafeById(existing.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该应用已存在推送配置(一个应用只允许一套凭证)');
    throw err;
  }
}

export async function deletePushConfig(id: number) {
  await ensurePushConfigExists(id);
  await db.delete(pushConfigs).where(eq(pushConfigs.id, id));
}

/** 按应用批量取启用凭证（适配器按设备所属应用分组投递时使用） */
export async function findEnabledPushConfigsByAppIds(appIds: number[]): Promise<Map<number, PushConfigRow>> {
  if (appIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(pushConfigs)
    .where(and(inArray(pushConfigs.appId, appIds), eq(pushConfigs.status, 'enabled')));
  return new Map(rows.map((row) => [row.appId, row]));
}

/** 测试发送:直发 registrationId,验证凭证与通道,成败都落发送记录 */
export async function testPushSend(configId: number, input: TestPushSendInput) {
  const config = await ensurePushConfigExists(configId);
  const [log] = await db.insert(pushSendLogs).values({
    configId: config.id,
    appId: config.appId,
    provider: config.provider,
    deviceCount: 1,
    title: input.title,
    content: input.content,
    status: 'pending',
    source: 'test',
  }).returning({ id: pushSendLogs.id });

  const result = await sendPushByProvider({
    config,
    registrationIds: [input.registrationId],
    title: input.title,
    content: input.content,
  });

  await db.update(pushSendLogs).set({
    status: result.success ? 'success' : 'failed',
    providerMsgId: result.msgId,
    errorMsg: result.errorMsg,
    sentAt: new Date(),
  }).where(eq(pushSendLogs.id, log.id));

  // 测试直发的 RID 若被供应商判无效且恰好是某设备的绑定,一并清理
  if (result.invalidRegistrationIds?.length) {
    await clearInvalidPushRegistrations(config.provider, result.invalidRegistrationIds);
  }

  if (!result.success) throw new HTTPException(400, { message: result.errorMsg ?? '推送发送失败' });
  return { msgId: result.msgId ?? null };
}
