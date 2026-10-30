/** CMS publication events and managed site Webhook subscription configuration. */
import { and, eq } from 'drizzle-orm';
import type { CmsOpenWebhookEvent } from '@zenith/shared/cms';
import { db } from '../../db';
import { appWebhookSubscriptions, cmsContents, cmsSites } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { encryptField } from '../../lib/encryption';
import { publishOpenEventInTx } from '../open-platform/open-events.service';
import { wakeEventConsumers } from '../../lib/domain-events';
import type { OutboxEventRow } from '../../db/schema/event-outbox';
import { resolveEffectiveCmsSiteRow } from './cms-site-inheritance.service';

export type CmsWebhookEventRef = Pick<OutboxEventRow, 'id' | 'eventId'>;

/** Persist an immutable content event with the actual business change. */
export async function insertCmsWebhookOutbox(
  executor: DbTransaction, event: CmsOpenWebhookEvent, siteId: number,
  data: Record<string, unknown>, eventKey: string,
): Promise<CmsWebhookEventRef> {
  return publishOpenEventInTx(executor, { type: event, tenantId: null, scope: { siteId }, data,
    businessKey: eventKey, orderingKey: `cms-site:${siteId}`,
    subjects: [{ type: 'cms.site', key: String(siteId), role: 'primary' }],
  });
}

/** Wake only after commit; ledger polling covers a lost hint. */
export const wakeCmsWebhookEvents = wakeEventConsumers;

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
  content: Pick<CmsContentRow, 'id' | 'siteId' | 'version'> & Partial<CmsContentRow>,
): Promise<CmsWebhookEventRef> {
  const [site] = await executor.select({ code: cmsSites.code, name: cmsSites.name })
    .from(cmsSites).where(eq(cmsSites.id, content.siteId)).limit(1);
  return insertCmsWebhookOutbox(
    executor,
    event,
    content.siteId,
    {
      site: { id: content.siteId, code: site?.code ?? null, name: site?.name ?? null },
      content: {
        id: content.id, channelId: content.channelId ?? null, title: content.title ?? null,
        slug: content.slug ?? null, status: content.status ?? null, version: content.version,
        publishedAt: content.publishedAt ? formatDateTime(content.publishedAt) : null,
      },
    },
    `${event}:${content.id}:v${content.version}`,
  );
}

// ─── 站点级 Webhook 配置 → 内部订阅 ────────────────────────────────────────

/**
 * 把站点设置里的 `webhookUrl` / `webhookSecret` 同步为一条 `internal` 订阅。
 *
 * 站点级 Webhook 复用统一投递管线：站点管理页的配置界面照旧，
 * 重试、投递日志、连续失败自动禁用与手工重投都随之适用。
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
