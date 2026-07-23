import { createHash } from 'node:crypto';
import dayjs from 'dayjs';
import { max } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { AsyncTask, BatchCmsInteractionStatusInput, CleanupCmsAdEventsInput } from '@zenith/shared';
import { cmsMemberSubscriptions } from '../../db/schema';
import type { CmsContentRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { formatDate } from '../../lib/datetime';
import {
  enqueueAsyncTask,
  mapAsyncTask,
  registerTaskHandler,
  submitAsyncTask,
} from '../../lib/task-center';
import logger from '../../lib/logger';
import { createMemberNotification } from '../member/member-notifications.service';
import {
  cleanupCmsAdEventsBatch,
  ensureCmsAdEventSiteAccess,
  getCmsAdEventRetentionDays,
} from './cms-ad-events.service';
import {
  ensureCmsInteractionExists,
  setCmsInteractionStatus,
} from './cms-interactions.service';
import { assertSiteAccess } from './cms-sites.service';
import {
  getPublicCmsSubscriptionNotificationContent,
  listCmsSubscriptionRecipients,
} from './cms-subscriptions.service';
import { isCmsPlatformAdmin } from './cms-access';

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

async function assertInteractionBatchAccess(ids: number[]): Promise<number[]> {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  for (const id of unique) {
    const row = await ensureCmsInteractionExists(id);
    await assertSiteAccess(row.siteId);
  }
  return unique;
}

export function registerCmsStage4TaskHandlers(): void {
  registerTaskHandler({
    taskType: 'cms-ad-events-cleanup',
    title: 'CMS 广告事件保留期清理',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const payload = ctx.payload as {
        siteId?: number;
        retentionDays?: number;
        systemTriggered?: boolean;
      };
      if (!payload.systemTriggered && !(await hasPermission('cms:ad-event:cleanup'))) {
        throw new Error('任务创建者的广告事件清理权限已失效');
      }
      if (!payload.systemTriggered && !payload.siteId && !isCmsPlatformAdmin()) {
        throw new Error('仅平台超管可清理全部站点广告事件');
      }
      if (payload.siteId) await ensureCmsAdEventSiteAccess(payload.siteId);
      let lastId = Number(ctx.checkpoint?.lastId ?? 0);
      let deleted = Number(ctx.checkpoint?.deleted ?? 0);
      for (;;) {
        const batch = await cleanupCmsAdEventsBatch({
          siteId: payload.siteId,
          retentionDays: payload.retentionDays,
          afterId: lastId,
          limit: 1000,
        });
        if (batch.deleted === 0 || !batch.lastId) break;
        lastId = batch.lastId;
        deleted += batch.deleted;
        await ctx.reportItems([{
          key: `batch:${lastId}`,
          label: `截至事件 #${lastId}`,
          status: 'success',
          message: `清理 ${batch.deleted} 条`,
        }]);
        const state = await ctx.progress({
          processed: deleted,
          total: null,
          note: `已按保留策略清理 ${deleted} 条广告事件`,
          checkpoint: { lastId, deleted },
        });
        if (state.cancelRequested) return { deleted, cancelled: true };
      }
      return { deleted };
    },
  });

  registerTaskHandler({
    taskType: 'cms-interactions-batch-status',
    title: 'CMS 互动问卷批量状态流转',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 3000,
    async run(ctx) {
      if (!(await hasPermission('cms:interaction:batch', 'cms:interaction:manage'))) {
        throw new Error('任务创建者的互动问卷批量管理权限已失效');
      }
      const payload = ctx.payload as BatchCmsInteractionStatusInput;
      const ids = await assertInteractionBatchAccess(payload.ids);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      for (let index = processed; index < ids.length; index += 1) {
        const id = ids[index];
        await setCmsInteractionStatus(id, payload.status);
        processed = index + 1;
        await ctx.reportItems([{
          key: `interaction:${id}`,
          label: `互动问卷 #${id}`,
          status: 'success',
          message: payload.status === 'published' ? '已发布' : '已关闭',
        }]);
        const state = await ctx.progress({
          processed,
          total: ids.length,
          note: `已处理 ${processed}/${ids.length} 项`,
          checkpoint: { processed, lastId: id },
        });
        if (state.cancelRequested) return { processed, cancelled: true };
      }
      return { processed };
    },
  });

  registerTaskHandler({
    taskType: 'cms-subscription-notify',
    title: 'CMS 订阅发布通知',
    module: 'CMS内容管理',
    allowConcurrent: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    async run(ctx) {
      const payload = ctx.payload as {
        systemTriggered?: boolean;
        contentId?: number;
        contentVersion?: number;
        title?: string;
        siteId?: number;
        channelId?: number;
        author?: string | null;
        subscriberCutoffId?: number;
      };
      if (
        !payload.systemTriggered
        || !payload.contentId
        || !payload.contentVersion
        || !payload.siteId
        || !payload.channelId
        || !payload.title
      ) {
        throw new Error('订阅通知任务载荷无效');
      }
      let lastSubscriptionId = Number(ctx.checkpoint?.lastSubscriptionId ?? 0);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let delivered = Number(ctx.checkpoint?.delivered ?? 0);
      const cutoff = Number(payload.subscriberCutoffId ?? 0);
      if (cutoff <= 0) return { processed: 0, delivered: 0 };
      for (;;) {
        const publicContent = await getPublicCmsSubscriptionNotificationContent(
          payload.contentId,
          payload.contentVersion,
        );
        if (!publicContent) {
          await ctx.reportItems([{
            key: `content:${payload.contentId}:not-public`,
            label: '内容公开状态复验',
            status: 'skipped',
            message: '站点、栏目或内容已停止公开，剩余通知不再发送',
          }]);
          return { processed, delivered, skipped: true };
        }
        const recipients = await listCmsSubscriptionRecipients(
          publicContent,
          lastSubscriptionId,
          cutoff,
          200,
        );
        if (recipients.length === 0) break;
        for (const recipient of recipients) {
          const created = await createMemberNotification({
            memberId: recipient.memberId,
            type: 'cms_content_published',
            title: '关注内容有更新',
            content: `「${publicContent.title.slice(0, 180)}」已发布，可前往 CMS 站点查看。`,
            bizId: `content:${payload.contentId}:version:${payload.contentVersion}`,
          });
          if (created) delivered += 1;
          processed += 1;
          lastSubscriptionId = recipient.subscriptionId;
          await ctx.reportItems([{
            key: `subscription:${recipient.subscriptionId}`,
            label: `订阅 #${recipient.subscriptionId}`,
            status: created ? 'success' : 'skipped',
            message: created ? '通知已发送' : '通知已存在，跳过',
          }]);
        }
        const state = await ctx.progress({
          processed,
          total: null,
          note: `已扫描 ${processed} 条匹配订阅，发送 ${delivered} 条通知`,
          checkpoint: { lastSubscriptionId, processed, delivered },
        });
        if (state.cancelRequested) return { processed, delivered, cancelled: true };
      }
      return { processed, delivered };
    },
  });
}

export async function submitCmsAdEventCleanupTask(input: CleanupCmsAdEventsInput) {
  if (!(await hasPermission('cms:ad-event:cleanup'))) {
    throw new HTTPException(403, { message: '无广告事件清理权限' });
  }
  if (!input.siteId && !isCmsPlatformAdmin()) {
    throw new HTTPException(403, { message: '仅平台超管可清理全部站点广告事件' });
  }
  if (input.siteId) await ensureCmsAdEventSiteAccess(input.siteId);
  const retentionDays = input.retentionDays ?? await getCmsAdEventRetentionDays();
  if (retentionDays <= 0) throw new HTTPException(400, { message: '广告事件自动保留期已关闭' });
  const row = await submitAsyncTask({
    taskType: 'cms-ad-events-cleanup',
    title: `CMS 广告事件清理（保留 ${retentionDays} 天）`,
    payload: { ...input, retentionDays },
    idempotencyKey: `cms-ad-cleanup:${input.siteId ?? 'all'}:${retentionDays}:${formatDate(new Date())}`,
  });
  return mapAsyncTask(row);
}

export async function submitCmsInteractionBatchStatusTask(input: BatchCmsInteractionStatusInput) {
  if (!(await hasPermission('cms:interaction:batch', 'cms:interaction:manage'))) {
    throw new HTTPException(403, { message: '无互动问卷批量管理权限' });
  }
  const ids = await assertInteractionBatchAccess(input.ids);
  const row = await submitAsyncTask({
    taskType: 'cms-interactions-batch-status',
    title: `CMS 互动问卷批量${input.status === 'published' ? '发布' : '关闭'}`,
    payload: { ids, status: input.status },
    idempotencyKey: `cms-interaction-status:${stableHash({ ids, status: input.status })}:${dayjs().format('YYYYMMDDHHmm')}`,
  });
  return mapAsyncTask(row);
}

export async function insertCmsSubscriptionNotificationOutbox(
  tx: DbTransaction,
  content: CmsContentRow,
): Promise<AsyncTask | null> {
  const [cutoff] = await tx.select({ id: max(cmsMemberSubscriptions.id) }).from(cmsMemberSubscriptions);
  const subscriberCutoffId = cutoff?.id ?? 0;
  if (subscriberCutoffId <= 0) return null;
  const row = await runWithCurrentUser({
    userId: 1,
    username: 'admin',
    roles: ['super_admin'],
    tenantId: null,
  }, () => submitAsyncTask({
    taskType: 'cms-subscription-notify',
    title: `CMS 订阅通知：${content.title.slice(0, 80)}`,
    payload: {
      systemTriggered: true,
      contentId: content.id,
      contentVersion: content.version,
      title: content.title,
      siteId: content.siteId,
      channelId: content.channelId,
      author: content.author,
      subscriberCutoffId,
    },
    idempotencyKey: `cms-subscription-notify:${content.id}:v${content.version}`,
  }, { executor: tx }));
  return mapAsyncTask(row);
}

export async function enqueueCmsSubscriptionNotification(task: AsyncTask | null): Promise<void> {
  if (!task) return;
  await enqueueAsyncTask(task.id).catch((error) => {
    logger.error(`[cms-subscription] 通知任务 #${task.id} 入队失败，等待 pending 恢复扫描补投`, error);
  });
}

export async function enqueueCmsAdRetentionSystemTask(): Promise<string> {
  const retentionDays = await getCmsAdEventRetentionDays();
  if (retentionDays <= 0) return '广告事件保留期清理已关闭';
  const row = await runWithCurrentUser({
    userId: 1,
    username: 'admin',
    roles: ['super_admin'],
    tenantId: null,
  }, () => submitAsyncTask({
    taskType: 'cms-ad-events-cleanup',
    title: `CMS 广告事件周期清理（保留 ${retentionDays} 天）`,
    payload: { retentionDays, systemTriggered: true },
    idempotencyKey: `cms-ad-cleanup:system:${retentionDays}:${formatDate(new Date())}`,
  }));
  await enqueueAsyncTask(row.id);
  return `已提交广告事件保留期清理任务 #${row.id}`;
}
