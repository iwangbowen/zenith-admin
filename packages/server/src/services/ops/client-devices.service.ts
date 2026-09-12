/**
 * 统一设备中心。
 *
 * 设备档案的三个写入口:
 *  1. 升级检查心跳（公开,匿名 upsert 平台/版本/活跃时间）——桌面端零改动白得;
 *  2. 登录后绑定推送（认证,写 subject + registrationId）——移动端集成推送 SDK 后调用;
 *  3. 登出解绑（认证,清 subject,设备档案保留）。
 * 读取方:推送渠道适配器（按 subject 找在活设备）、升级看板（在网/版本分布)、管理端设备列表。
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { AppArch, AppPlatform, BindPushDeviceInput, DeviceSubjectType } from '@zenith/shared/ops';
import { clientDeviceContract } from '@zenith/shared/ops';
import { db } from '../../db';
import { clientApps, clientDevices, members, type ClientDeviceRow } from '../../db/schema';
import { formatDateTime } from '../../lib/datetime';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { pageOffset } from '../../lib/pagination';
import logger from '../../lib/logger';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { resolveUserNames } from '../../lib/user-nicknames';

/** 判定「在活设备」的窗口（管理端列表徽标与推送寻址共用） */
export const DEVICE_ACTIVE_WINDOW_DAYS = 30;

export function mapClientDevice(row: ClientDeviceRow, appName?: string, subjectName?: string | null) {
  return {
    id: row.id,
    deviceId: row.deviceId,
    appId: row.appId,
    appName,
    platform: row.platform,
    arch: row.arch ?? null,
    deviceModel: row.deviceModel ?? null,
    osVersion: row.osVersion ?? null,
    appVersion: row.appVersion ?? null,
    subjectType: (row.subjectType as DeviceSubjectType | null) ?? null,
    subjectId: row.subjectId ?? null,
    subjectName: subjectName ?? null,
    pushProvider: row.pushProvider ?? null,
    pushRegistrationId: row.pushRegistrationId ?? null,
    pushEnabled: row.pushEnabled,
    createdAt: formatDateTime(row.createdAt),
    lastActiveAt: formatDateTime(row.lastActiveAt),
  };
}

// ─── 心跳（升级检查顺手 upsert,公开链路,失败不影响主流程）─────────────────────

export interface DeviceHeartbeatInput {
  deviceId: string;
  appId: number;
  platform: AppPlatform;
  arch?: AppArch;
  appVersion?: string;
}

export async function upsertDeviceHeartbeat(input: DeviceHeartbeatInput): Promise<void> {
  try {
    await db
      .insert(clientDevices)
      .values({
        deviceId: input.deviceId,
        appId: input.appId,
        platform: input.platform,
        arch: input.arch ?? null,
        appVersion: input.appVersion ?? null,
      })
      .onConflictDoUpdate({
        target: clientDevices.deviceId,
        set: {
          appId: input.appId,
          platform: input.platform,
          ...(input.arch ? { arch: input.arch } : {}),
          ...(input.appVersion ? { appVersion: input.appVersion } : {}),
          lastActiveAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn(`[client-devices] 设备心跳写入失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── 推送绑定（认证链路）──────────────────────────────────────────────────────

export async function bindPushDevice(subjectType: DeviceSubjectType, subjectId: number, input: BindPushDeviceInput) {
  const app = await requireFirstRow(
    db
      .select({ id: clientApps.id })
      .from(clientApps)
      .where(and(eq(clientApps.appKey, input.app), eq(clientApps.status, 'enabled')))
      .limit(1),
    '应用不存在',
  );

  return db.transaction(async (tx) => {
    // registrationId 唯一:换机/重装后同一 registrationId 出现在新 deviceId 上,先清旧绑定
    await tx
      .update(clientDevices)
      .set({ pushProvider: null, pushRegistrationId: null })
      .where(and(
        eq(clientDevices.pushProvider, input.provider),
        eq(clientDevices.pushRegistrationId, input.registrationId),
        sql`${clientDevices.deviceId} <> ${input.deviceId}`,
      ));

    const [row] = await tx
      .insert(clientDevices)
      .values({
        deviceId: input.deviceId,
        appId: app.id,
        platform: input.platform,
        arch: input.arch ?? null,
        deviceModel: input.deviceModel ?? null,
        osVersion: input.osVersion ?? null,
        appVersion: input.appVersion ?? null,
        subjectType,
        subjectId,
        pushProvider: input.provider,
        pushRegistrationId: input.registrationId,
        pushEnabled: input.pushEnabled,
      })
      .onConflictDoUpdate({
        target: clientDevices.deviceId,
        set: {
          appId: app.id,
          platform: input.platform,
          arch: input.arch ?? null,
          deviceModel: input.deviceModel ?? null,
          osVersion: input.osVersion ?? null,
          appVersion: input.appVersion ?? null,
          subjectType,
          subjectId,
          pushProvider: input.provider,
          pushRegistrationId: input.registrationId,
          pushEnabled: input.pushEnabled,
          lastActiveAt: new Date(),
        },
      })
      .returning();
    return mapClientDevice(row);
  });
}

/** 登出解绑:清绑定人,设备档案与推送标识保留（匿名设备仍可收全员类推送?否——无主体即不可达） */
export async function unbindPushDevice(subjectType: DeviceSubjectType, subjectId: number, deviceId: string) {
  await db
    .update(clientDevices)
    .set({ subjectType: null, subjectId: null })
    .where(and(
      eq(clientDevices.deviceId, deviceId),
      eq(clientDevices.subjectType, subjectType),
      eq(clientDevices.subjectId, subjectId),
    ));
}

// ─── 推送寻址（渠道适配器使用）────────────────────────────────────────────────

/** 收件人的全部在活可推送设备（pushEnabled 且窗口内活跃） */
export async function findPushableDevices(subjectType: DeviceSubjectType, subjectId: number): Promise<ClientDeviceRow[]> {
  const since = new Date(Date.now() - DEVICE_ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return db
    .select()
    .from(clientDevices)
    .where(and(
      eq(clientDevices.subjectType, subjectType),
      eq(clientDevices.subjectId, subjectId),
      eq(clientDevices.pushEnabled, true),
      isNotNull(clientDevices.pushRegistrationId),
      gte(clientDevices.lastActiveAt, since),
    ));
}

/**
 * 供应商判定无效的 registrationId → 清除设备推送绑定（设备档案保留）。
 * 触发源:发送响应 1003/1011、回执回调点名的失效 RID。清理失败只告警,不影响主流程。
 */
export async function clearInvalidPushRegistrations(provider: string, registrationIds: string[]): Promise<void> {
  if (registrationIds.length === 0) return;
  try {
    const rows = await db
      .update(clientDevices)
      .set({ pushProvider: null, pushRegistrationId: null })
      .where(and(
        eq(clientDevices.pushProvider, provider as ClientDeviceRow['pushProvider'] & string),
        inArray(clientDevices.pushRegistrationId, registrationIds),
      ))
      .returning({ deviceId: clientDevices.deviceId });
    if (rows.length > 0) {
      logger.info(`[client-devices] 已清理 ${rows.length} 台设备的无效推送绑定: ${rows.map((r) => r.deviceId).join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[client-devices] 清理无效推送绑定失败: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── 管理端 ───────────────────────────────────────────────────────────────────

export async function listClientDevices(q: QueryOutputOf<typeof clientDeviceContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    q.appId !== undefined ? eq(clientDevices.appId, q.appId) : undefined,
    q.platform ? eq(clientDevices.platform, q.platform) : undefined,
    q.subjectType ? eq(clientDevices.subjectType, q.subjectType) : undefined,
    q.pushBound ? isNotNull(clientDevices.pushRegistrationId) : undefined,
    keywordCondition(q.keyword, [clientDevices.deviceId, clientDevices.deviceModel, clientDevices.appVersion]),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(clientDevices, where),
    rows: async () => {
      const rows = await db.query.clientDevices.findMany({
        where,
        with: { app: { columns: { name: true } } },
        orderBy: [desc(clientDevices.lastActiveAt)],
        limit: pageSize,
        offset: pageOffset(page, pageSize),
      });

      // 绑定人显示名（user → 昵称,member → 昵称/手机号）
      const memberIds = [...new Set(rows.filter((r) => r.subjectType === 'member' && r.subjectId).map((r) => r.subjectId as number))];
      const [userNameMap, memberRows] = await Promise.all([
        resolveUserNames(rows.filter((r) => r.subjectType === 'user').map((r) => r.subjectId)),
        memberIds.length ? db.select({ id: members.id, nickname: members.nickname }).from(members).where(inArray(members.id, memberIds)) : [],
      ]);
      const memberNameMap = new Map(memberRows.map((r) => [r.id, r.nickname]));

      return rows.map((row) => mapClientDevice(
        row,
        row.app?.name,
        row.subjectType === 'user' ? userNameMap.get(row.subjectId ?? -1) : row.subjectType === 'member' ? memberNameMap.get(row.subjectId ?? -1) : null,
      ));
    },
  });
}

export async function ensureClientDeviceExists(id: number): Promise<ClientDeviceRow> {
  return requireFirstRow(
    db.select().from(clientDevices).where(eq(clientDevices.id, id)).limit(1),
    '设备不存在',
  );
}

export async function getClientDeviceBeforeAudit(id: number) {
  return mapClientDevice(await ensureClientDeviceExists(id));
}

/** 管理端强制解绑推送（不删设备档案） */
export async function adminUnbindDevicePush(id: number) {
  await ensureClientDeviceExists(id);
  await db
    .update(clientDevices)
    .set({ subjectType: null, subjectId: null, pushProvider: null, pushRegistrationId: null })
    .where(eq(clientDevices.id, id));
}

export async function deleteClientDevice(id: number) {
  await ensureClientDeviceExists(id);
  await db.delete(clientDevices).where(eq(clientDevices.id, id));
}

// ─── 升级看板取数（直查设备表）────────────────────────────────────────────────

/** 窗口内在活设备数 */
export async function countActiveDevices(appId: number, since: Date): Promise<number> {
  return db.$count(clientDevices, and(eq(clientDevices.appId, appId), gte(clientDevices.lastActiveAt, since)));
}

/** 在活设备的版本分布 */
export async function getDeviceVersionDistribution(appId: number, since: Date) {
  return db
    .select({ version: clientDevices.appVersion, devices: sql<number>`count(*)::int` })
    .from(clientDevices)
    .where(and(
      eq(clientDevices.appId, appId),
      gte(clientDevices.lastActiveAt, since),
      isNotNull(clientDevices.appVersion),
    ))
    .groupBy(clientDevices.appVersion)
    .orderBy(desc(sql`count(*)`))
    .limit(20);
}
