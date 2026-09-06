/**
 * 行为中心阶段 1：服务端权威语义事件。
 *
 * 首批权威事件来自 paymentEventBus（5 种）、workflowEventBus（14 种，经 event_dispatch 作业投递）
 * 以及会员关键业务操作（注册 / 资料更新 / 积分变动 / 优惠券领取核销 / 签到），统一落同一张
 * user_events 表，source='server'，与 HTTP 采集（analytics.service.ts）共用 Tracking Plan 治理、
 * 事件字典登记与用户画像 upsert，但完全不经 HTTP 请求路径，也不会阻断触发方的业务事务/事件总线投递。
 *
 * 设计要点：
 * - trackServerEvent() 调用立即返回（queueMicrotask 异步执行），内部任何失败都仅 logger 记录，
 *   绝不向上抛出 —— 服务端事件是"锦上添花"的分析数据，不能成为业务可靠性的新故障点。
 * - 幂等：eventId 复用来源事件总线的稳定 eventId —— workflow 经 event_dispatch 保留原始 UUID；
 *   payment outbox 投递的是 `payment-outbox-{id}` 稳定字符串（非 UUID），本服务对其做确定性
 *   UUID 派生（deriveDeterministicUuid），at-least-once 重投仍映射到同一 UUID；
 *   会员业务事件没有天然稳定 ID，每次调用生成新 UUID（一次性动作，无重试去重诉求）；
 *   落库统一走 user_events.event_id 唯一索引 onConflictDoNothing。
 * - 身份优先级：memberId（m:{id}）> userId（u:{id}）> `server:{appId}`；两者若同时传入，
 *   以 memberId 为准（会员事件与管理员事件互斥，不应同时归属两种身份）。
 * - 严格禁止复用 lib/analytics-helpers.ts 的 resolveIngestPlatformFields —— 该函数专为 HTTP
 *   采集设计，安全上永远不会返回 source='server'，服务端事件必须自行构造平台字段。
 * - 服务端事件不创建 analytics_sessions 行，落库 sessionId=null（会话数按 COUNT(DISTINCT session_id)
 *   统计，NULL 不计入，避免虚增）：一事件一会话会导致会话表膨胀且无实际会话语义，
 *   仅按需 upsert 用户画像（analytics_user_profiles），会话相关看板对服务端事件不做会话粒度统计。
 */
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../../db';
import { userEvents } from '../../db/schema';
import type { AnalyticsEnvironment, AnalyticsEventSource, AnalyticsIdentityType, TrackEventInput } from '@zenith/shared/analytics';
import { ANALYTICS_PROPERTIES_MAX_BYTES } from '@zenith/shared/analytics';
import { isPlainObject, jsonByteLength, jsonDepth } from '@zenith/shared/core';
import { parseDateTimeInput } from '../../lib/datetime';
import { evaluateEvents, recordSchemaIssues } from './analytics-governance.service';
import { touchEventMeta } from './analytics-event-meta.service';
import { upsertUserProfilesBatch, type ProfileUpsertInput } from './analytics-profile.service';
import logger from '../../lib/logger';

const DEFAULT_SERVER_APP_ID = 'server';
const PROPERTIES_MAX_KEYS = 50;
const PROPERTIES_MAX_DEPTH = 6;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 非 UUID 的稳定 eventId（如支付 outbox 的 `payment-outbox-{id}`）→ 确定性 UUID。
 * outbox 是 at-least-once 投递：任何订阅者失败都会导致整行重投，若此处每次重新
 * randomUUID() 则 user_events.event_id 唯一索引的跨投递去重完全失效、产生重复事件行。
 * SHA-256 截取 16 字节并打上 v5/RFC4122 标记位，同一稳定 ID 永远映射到同一 UUID。
 */
function deriveDeterministicUuid(stableId: string): string {
  const bytes = createHash('sha256').update(`zenith:analytics-server-event:${stableId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TrackServerEventInput {
  /** 语义事件名，务必来自 shared `ANALYTICS_SEMANTIC_EVENT_NAMES`，禁止裸字符串拼写 */
  eventName: string;
  /** 来源事件总线的稳定 eventId（payment/workflow 均自带），未传时生成随机 UUID */
  eventId?: string;
  /** 业务发生时间；未传使用当前时间，不对偏差做客户端式限制（服务端时间天然可信） */
  occurredAt?: string | Date;
  tenantId?: number | null;
  userId?: number | null;
  memberId?: number | null;
  /** 展示名（用户名/会员昵称等），仅用于画像展示，不参与身份判定 */
  displayName?: string | null;
  /** 应用标识，默认 'server'；多来源服务端进程可用于区分（如未来拆分微服务） */
  appId?: string;
  /** 属性袋：调用点只应传白名单标量字段，禁止整对象/凭据 */
  properties?: Record<string, unknown> | null;
}

/**
 * 属性袋安全裁剪：键数 / 序列化字节数 / 嵌套深度超限则整体丢弃为 null（而非抛错或截断半条数据），
 * 约束口径与客户端采集的 `boundedJsonRecord('事件属性', 50, ANALYTICS_PROPERTIES_MAX_BYTES)` 一致。
 */
function sanitizeServerProperties(properties: Record<string, unknown> | null | undefined, eventName: string): Record<string, unknown> | null {
  if (properties == null) return null;
  if (!isPlainObject(properties)) {
    logger.warn('[analytics-server-events] properties 非普通对象，已丢弃', { eventName });
    return null;
  }
  const keyCount = Object.keys(properties).length;
  if (keyCount > PROPERTIES_MAX_KEYS) {
    logger.warn('[analytics-server-events] properties 键数超限，已丢弃', { eventName, keyCount });
    return null;
  }
  if (jsonDepth(properties) > PROPERTIES_MAX_DEPTH) {
    logger.warn('[analytics-server-events] properties 嵌套层级超限，已丢弃', { eventName });
    return null;
  }
  if (jsonByteLength(properties) > ANALYTICS_PROPERTIES_MAX_BYTES) {
    logger.warn('[analytics-server-events] properties 序列化体积超限，已丢弃', { eventName });
    return null;
  }
  return properties;
}

/** 身份 → distinctId：会员 > 管理员 > 服务端匿名兜底，与 max 64 字符列约束保持一致 */
function resolveServerDistinctId(memberId: number | null, userId: number | null, appId: string): string {
  if (memberId != null) return `m:${memberId}`.slice(0, 64);
  if (userId != null) return `u:${userId}`.slice(0, 64);
  return `server:${appId}`.slice(0, 64);
}

/** 采集环境：shared AnalyticsEnvironment 仅支持 3 值，NODE_ENV 非 production 一律归为 development */
function resolveServerEnvironment(): AnalyticsEnvironment {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function resolveServerSdkVersion(): string | null {
  return process.env.npm_package_version ?? null;
}

/** `/server` 或 `/server/<domain>`，domain 取 eventName 第一个 `.` 分段前缀（payment/workflow/member）*/
function resolveServerPagePath(eventName: string): string {
  const domain = eventName.split('.')[0];
  return domain ? `/server/${domain}` : '/server';
}

/**
 * 实际持久化逻辑，导出供单元测试直接 await（trackServerEvent 本身是 fire-and-forget，无法直接断言）。
 * 内部任何异常都会被吞掉（best-effort），调用方无需 catch。
 */
export async function persistServerEvent(input: TrackServerEventInput): Promise<void> {
  try {
    if (!input.eventName) {
      logger.warn('[analytics-server-events] 缺少 eventName，已忽略');
      return;
    }
    const appId = input.appId?.trim() || DEFAULT_SERVER_APP_ID;
    // UUID 直接复用；非 UUID 的稳定 ID 确定性派生（跨重投幂等）；未提供才随机生成
    const eventId = input.eventId
      ? (UUID_PATTERN.test(input.eventId) ? input.eventId : deriveDeterministicUuid(input.eventId))
      : randomUUID();
    // 会员 / 管理员身份互斥：同时传入时以会员身份为准，避免服务端事件归属到两种身份
    const memberId = input.memberId ?? null;
    const userId = memberId != null ? null : (input.userId ?? null);
    const tenantId = input.tenantId ?? null;
    const source: AnalyticsEventSource = 'server';
    const environment = resolveServerEnvironment();
    const distinctId = resolveServerDistinctId(memberId, userId, appId);
    const occurredAt = parseDateTimeInput(input.occurredAt ?? null) ?? undefined;
    const properties = sanitizeServerProperties(input.properties, input.eventName);

    // 复用 Tracking Plan 治理：全局屏蔽 / 租户禁用 / 严格模式 schema 校验与 web 采集语义一致
    const governanceInput: TrackEventInput = {
      eventId,
      sessionId: eventId, // 仅满足治理入参契约（min 1）；落库行 sessionId 为 null，见下
      distinctId,
      eventType: 'custom',
      eventName: input.eventName,
      pagePath: resolveServerPagePath(input.eventName),
      properties: properties ?? undefined,
      source,
      appId,
      environment,
    };
    const { accepted, pendingSchemaIssues } = await evaluateEvents([governanceInput], tenantId);
    if (accepted.length === 0) return; // 全局屏蔽 / 租户禁用 / 严格模式 schema 拒收，治理内部已记录质量问题

    const identityType: AnalyticsIdentityType = memberId != null ? 'member' : userId != null ? 'admin' : 'anonymous';
    const displayName = input.displayName ?? null;

    const row = {
      eventId,
      tenantId,
      distinctId,
      userId,
      username: displayName,
      // 服务端事件无会话语义，必须落 null：概览/趋势/rollup 的会话数用 COUNT(DISTINCT session_id)
      // 统计（NULL 不计入），若复用 eventId 会导致每个服务端事件虚增一个"会话"
      sessionId: null,
      eventType: 'custom' as const,
      eventName: input.eventName,
      pagePath: resolveServerPagePath(input.eventName),
      properties: properties ?? null,
      source,
      appId,
      environment,
      sdkVersion: resolveServerSdkVersion(),
      memberId,
      ...(occurredAt ? { createdAt: occurredAt } : {}),
    };

    const inserted = await db.transaction(async (tx) => {
      const insertedRows = await tx
        .insert(userEvents)
        .values(row)
        .onConflictDoNothing({ target: userEvents.eventId })
        .returning({ eventId: userEvents.eventId });
      if (insertedRows.length === 0) return false; // 幂等命中：已存在同 eventId 事件，其余落库动作全部跳过

      const profileInput: ProfileUpsertInput = {
        tenantId,
        distinctId,
        identityType,
        userId,
        memberId,
        displayName,
        properties: { source, appId, environment },
      };
      await upsertUserProfilesBatch(tx, [profileInput]);
      return true;
    });
    if (!inserted) return;

    if (pendingSchemaIssues.length > 0) {
      await Promise.allSettled(
        pendingSchemaIssues.map((p) => recordSchemaIssues(p.tenantId, input.eventName, p.issues)),
      );
    }
    // 事件字典登记（best-effort，不阻塞；tenantId 传 0 哨兵与治理缓存 key 约定一致）
    void touchEventMeta([governanceInput], tenantId).catch(() => { /* ignore */ });
  } catch (err) {
    logger.error('[analytics-server-events] persistServerEvent 失败', { eventName: input.eventName, err });
  }
}

/**
 * 服务端权威事件埋点入口：调用立即返回，实际持久化异步执行且永不抛出。
 * 业务代码应在事务/关键操作成功返回前调用（best-effort，不影响主流程）。
 */
export function trackServerEvent(input: TrackServerEventInput): void {
  queueMicrotask(() => {
    void persistServerEvent(input).catch((err) => {
      logger.error('[analytics-server-events] trackServerEvent 未捕获异常', { eventName: input.eventName, err });
    });
  });
}
