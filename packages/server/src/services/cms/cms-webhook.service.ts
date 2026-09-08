/**
 * CMS 内容事件外推。
 *
 * 原先是 fire-and-forget 的直接 POST：失败只打日志，进程崩溃即丢事件，也没有重试与投递记录。
 * 现改为接入开放平台既有的 Webhook 投递管线（`app_webhook_subscriptions` +
 * `app_webhook_deliveries`），白捡到 HMAC 签名、eventId 去重、指数退避重试、连续失败自动禁用、
 * 投递日志与后台手工重投。
 *
 * 可靠性链路：
 *   业务事务内写任务中心 outbox（`cms-webhook-emit`）→ worker 取出后 emit 到事件总线
 *   → 订阅者持久化 delivery → 投递 / 重试。
 * 事务提交即代表事件不会丢；worker 崩溃由任务中心的 pending 恢复扫描补投。
 *
 * 站点设置里的 webhookUrl 不再自己发请求，而是托管为一条 `internal` 订阅（见
 * syncCmsSiteWebhookSubscription），因此站点级 Webhook 同样享有重试与投递日志。
 */
import { and, eq } from 'drizzle-orm';
import type { CmsOpenWebhookEvent } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { db } from '../../db';
import { appWebhookSubscriptions, cmsContents, cmsSites } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { runWithCurrentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { encryptField } from '../../lib/encryption';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { enqueueAsyncTask, mapAsyncTask, persistAsyncTask, registerTaskHandler } from '../../lib/task-center';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';

export const CMS_WEBHOOK_EMIT_TASK = 'cms-webhook-emit';

const SYSTEM_ACTOR = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };

interface CmsWebhookPayload {
  event: CmsOpenWebhookEvent;
  siteId: number;
  data: Record<string, unknown>;
  systemTriggered: true;
}

/**
 * 在业务事务内登记事件（outbox）。
 *
 * 返回的任务需在事务提交后由调用方 `enqueueCmsWebhookEvents` 入队；
 * 入队失败也不丢，任务中心的 pending 恢复扫描会补投。
 */
export async function insertCmsWebhookOutbox(
  executor: DbTransaction,
  event: CmsOpenWebhookEvent,
  siteId: number,
  data: Record<string, unknown>,
  eventKey: string,
): Promise<AsyncTask | null> {
  try {
    const row = await runWithCurrentUser(SYSTEM_ACTOR, () => persistAsyncTask(executor, {
      taskType: CMS_WEBHOOK_EMIT_TASK,
      title: `CMS 事件外推：${event}`,
      payload: { event, siteId, data, systemTriggered: true } satisfies CmsWebhookPayload,
      idempotencyKey: `cms-webhook:${eventKey}`.slice(0, 128),
    }));
    return mapAsyncTask(row);
  } catch (error) {
    // 事件外推不得阻断内容发布：登记失败只记日志
    logger.error(`[cms-webhook] 事件 ${event} 登记失败（site #${siteId}）`, error);
    return null;
  }
}

export async function enqueueCmsWebhookEvents(tasks: readonly (AsyncTask | null)[]): Promise<void> {
  for (const task of tasks) {
    if (!task) continue;
    await enqueueAsyncTask(task.id).catch((error) => {
      logger.error(`[cms-webhook] 事件任务 #${task.id} 入队失败，等待 pending 恢复扫描补投`, error);
    });
  }
}

/** 内容事件的标准 payload */
export async function buildCmsContentEventData(contentId: number): Promise<Record<string, unknown> | null> {
  const [content] = await db.select({
    id: cmsContents.id,
    siteId: cmsContents.siteId,
    channelId: cmsContents.channelId,
    title: cmsContents.title,
    slug: cmsContents.slug,
    status: cmsContents.status,
    version: cmsContents.version,
    publishedAt: cmsContents.publishedAt,
  }).from(cmsContents).where(eq(cmsContents.id, contentId)).limit(1);
  if (!content) return null;
  const [site] = await db.select({ code: cmsSites.code, name: cmsSites.name })
    .from(cmsSites).where(eq(cmsSites.id, content.siteId)).limit(1);
  return {
    site: { id: content.siteId, code: site?.code ?? null, name: site?.name ?? null },
    content: {
      id: content.id,
      channelId: content.channelId,
      title: content.title,
      slug: content.slug,
      status: content.status,
      version: content.version,
      publishedAt: content.publishedAt ? formatDateTime(content.publishedAt) : null,
    },
  };
}

/**
 * 内容事件登记（发布/更新/下线/回收/删除）。
 *
 * eventKey 带内容版本，同一版本重复触发天然幂等；投递侧还有 `eventId` 唯一屏障兜底。
 */
export async function insertCmsContentWebhookOutbox(
  executor: DbTransaction,
  event: CmsOpenWebhookEvent,
  content: Pick<CmsContentRow, 'id' | 'siteId' | 'version'>,
): Promise<AsyncTask | null> {
  return insertCmsWebhookOutbox(
    executor,
    event,
    content.siteId,
    { contentId: content.id },
    `${event}:${content.id}:v${content.version}`,
  );
}

// ─── 任务处理：从 outbox 取出后 emit 到事件总线 ─────────────────────────────

export function registerCmsWebhookTaskHandler(): void {
  registerTaskHandler({
    taskType: CMS_WEBHOOK_EMIT_TASK,
    title: 'CMS 事件外推',
    module: 'CMS内容管理',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const payload = ctx.payload as unknown as CmsWebhookPayload;
      let data = payload.data;
      // 内容事件只登记 id，emit 前取最新快照，避免 outbox 里存冗余副本
      if (typeof data.contentId === 'number') {
        const built = await buildCmsContentEventData(data.contentId);
        if (!built) return { skipped: true, reason: '内容已不存在' };
        data = built;
      }
      // emitAndWait：等订阅者把 delivery 持久化后再算任务成功，失败可由任务中心重试
      await openEventBus.emitAndWait({
        type: payload.event,
        scope: { siteId: payload.siteId },
        data,
      });
      return { event: payload.event, siteId: payload.siteId };
    },
  });
}

// ─── 站点级 Webhook 配置 → 内部订阅 ────────────────────────────────────────

/**
 * 把站点设置里的 `webhookUrl` / `webhookSecret` 同步为一条 `internal` 订阅。
 *
 * 站点管理页的 Webhook 配置界面不变，但底层换成了统一投递管线，
 * 因此站点级 Webhook 也有了重试、投递日志、连续失败自动禁用与手工重投。
 */
export async function syncCmsSiteWebhookSubscription(siteId: number): Promise<void> {
  const site = await resolveEffectiveCmsSiteRow(siteId).catch(() => null);
  const settings = (site?.settings ?? {}) as Record<string, unknown>;
  const url = typeof settings.webhookUrl === 'string' ? settings.webhookUrl.trim() : '';
  const secret = typeof settings.webhookSecret === 'string' ? settings.webhookSecret : '';
  const [existing] = await db.select().from(appWebhookSubscriptions)
    .where(and(eq(appWebhookSubscriptions.cmsSiteId, siteId), eq(appWebhookSubscriptions.internal, true)))
    .limit(1);

  const enabled = Boolean(url) && (url.startsWith('http://') || url.startsWith('https://'));
  if (!enabled) {
    if (existing) await db.delete(appWebhookSubscriptions).where(eq(appWebhookSubscriptions.id, existing.id));
    return;
  }

  const values = {
    clientId: null,
    tenantId: null,
    name: `站点 #${siteId} Webhook`,
    url,
    secretEncrypted: secret ? encryptField(secret) : null,
    signMode: (secret ? 'hmacSha256' : 'none') as 'hmacSha256' | 'none',
    events: [] as string[],
    cmsSiteId: siteId,
    internal: true,
    status: 'enabled' as const,
  };
  if (existing) {
    await db.update(appWebhookSubscriptions).set(values).where(eq(appWebhookSubscriptions.id, existing.id));
  } else {
    await db.insert(appWebhookSubscriptions).values(values);
  }
}
