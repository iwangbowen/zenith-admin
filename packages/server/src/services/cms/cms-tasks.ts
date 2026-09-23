import { registerTaskHandler } from '../../lib/task-center';
import { rebuildSearchIndex } from './cms-search.service';
import { registerCmsDeadlinkTaskHandler } from './cms-deadlink.service';
import { registerCmsCollectTaskHandler } from './cms-collect.service';
import { isCmsPlatformAdmin } from './cms-access';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { registerCmsResourceTaskHandler } from './cms-resource-tasks';
import { registerCmsPublishingTaskHandler } from './cms-publishing.service';
import { registerCmsStage4TaskHandlers } from './cms-stage4-tasks';
import { registerCmsDistributionTaskHandler } from './cms-distributions.service';
import { registerCmsWebhookTaskHandler } from './cms-webhook.service';
import { registerCmsWidgetTaskHandlers } from './cms-widget-tasks';
import { registerCmsReleaseTaskHandler } from './cms-releases.service';
import { registerCmsCdnTaskHandler } from './cms-cdn.service';
import { registerCmsPublicationEffectTasks } from './cms-publication-effects.service';
import type { CmsCapturedConfiguration } from './cms-configuration-snapshot.service';

/** CMS 任务中心 handler 注册（index.ts 启动流程中、registerSystemTasks 之前调用） */
export function registerCmsTaskHandlers(): void {
  registerCmsDeadlinkTaskHandler();
  registerCmsCollectTaskHandler();
  registerCmsResourceTaskHandler();
  registerCmsPublishingTaskHandler();
  registerCmsStage4TaskHandlers();
  registerCmsDistributionTaskHandler();
  registerCmsWebhookTaskHandler();
  registerCmsWidgetTaskHandlers();
  registerCmsReleaseTaskHandler();
  registerCmsCdnTaskHandler();
  registerCmsPublicationEffectTasks();

  registerTaskHandler({
    taskType: 'cms-search-reindex',
    title: 'CMS 检索索引重建',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const payload = ctx.payload as { siteId?: number | null };
      const siteId = payload.siteId ?? null;
      if (siteId) await assertAllCmsSiteChannelsAccess(siteId);
      else if (!isCmsPlatformAdmin()) throw new Error('非平台管理员不可重建全部 CMS 索引');
      const startAfterId = Number(ctx.checkpoint?.lastId ?? 0);
      const processedBefore = Number(ctx.checkpoint?.processed ?? 0);
      const processed = await rebuildSearchIndex({
        siteId,
        startAfterId,
        onProgress: async (batchProcessed, total, lastId) => {
          const { cancelRequested } = await ctx.progress({
            processed: processedBefore + batchProcessed,
            total,
            note: `已重建 ${processedBefore + batchProcessed}/${total} 条`,
            checkpoint: { lastId, processed: processedBefore + batchProcessed },
          });
          return cancelRequested;
        },
      });
      const { createCmsConfigurationRelease } = await import('./cms-releases.service');
      const captures = ctx.payload.configurationCaptures as Record<string, CmsCapturedConfiguration> | undefined;
      if (!captures) throw new Error('检索任务缺少提交时配置快照，请重新提交');
      for (const [id, frozen] of Object.entries(captures)) await createCmsConfigurationRelease(Number(id), ctx.taskId, '检索词典与索引更新', frozen);
      return { processed: processedBefore + processed };
    },
  });
}
