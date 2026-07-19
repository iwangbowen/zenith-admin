import { registerTaskHandler } from '../../lib/task-center';
import { buildSiteStatic } from './cms-static.service';
import { rebuildSearchIndex } from './cms-search.service';

/** CMS 任务中心 handler 注册（index.ts 启动流程中、registerSystemTasks 之前调用） */
export function registerCmsTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'cms-static-build',
    title: 'CMS 全站静态化',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const siteId = Number((ctx.payload as { siteId?: number })?.siteId);
      if (!siteId) throw new Error('缺少 siteId 参数');
      const result = await buildSiteStatic(siteId, async (p) => {
        const { cancelRequested } = await ctx.progress({
          processed: p.processed,
          total: p.total,
          note: p.note,
        });
        return cancelRequested;
      });
      return { pages: result.pages };
    },
  });

  registerTaskHandler({
    taskType: 'cms-search-reindex',
    title: 'CMS 检索索引重建',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const siteId = (ctx.payload as { siteId?: number | null })?.siteId ?? null;
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
      return { processed: processedBefore + processed };
    },
  });
}
