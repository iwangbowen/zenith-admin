import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsResources } from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import {
  deleteCmsOrphanResource, isCmsResourceOrphan, listCmsResourceReferences, listCmsResourcesAfter, moveCmsResources,
} from './cms-resources.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsResourceTaskPayload as GovernancePayload } from './cms-resource-task-submit.service';

export const CMS_RESOURCE_GOVERNANCE_TASK = 'cms-resource-governance';

export function registerCmsResourceTaskHandler(): void {
  registerTaskHandler({
    taskType: CMS_RESOURCE_GOVERNANCE_TASK,
    title: 'CMS 素材治理',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 3000,
    async run(ctx) {
      const payload = ctx.payload as GovernancePayload;
      await assertSiteAccess(Number(payload.siteId));
      if (payload.operation === 'move') {
        const ids = [...new Set(payload.resourceIds)].filter((id) => Number.isInteger(id) && id > 0);
        let processed = Number(ctx.checkpoint?.processed ?? 0);
        for (let index = processed; index < ids.length; index++) {
          const id = ids[index];
          try {
            await moveCmsResources([id], payload.folderId);
            await ctx.reportItems([{ key: `resource-${id}`, label: `素材 #${id}`, status: 'success', message: '移动成功', data: { siteId: payload.siteId, resourceId: id, operation: 'move' } }]);
          } catch (err) {
            await ctx.reportItems([{ key: `resource-${id}`, label: `素材 #${id}`, status: 'failed', message: err instanceof Error ? err.message : '移动失败', data: { siteId: payload.siteId, resourceId: id, operation: 'move' } }]);
          }
          processed = index + 1;
          const { cancelRequested } = await ctx.progress({
            processed,
            total: ids.length,
            note: `已移动 ${processed}/${ids.length}`,
            checkpoint: { processed },
          });
          if (cancelRequested) return { operation: 'move', processed, total: ids.length };
        }
        return { operation: 'move', processed, total: ids.length };
      }

      const total = await db.$count(cmsResources, eq(cmsResources.siteId, payload.siteId));
      let lastId = Number(ctx.checkpoint?.lastId ?? 0);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let orphanCount = Number(ctx.checkpoint?.orphanCount ?? 0);
      let deletedCount = Number(ctx.checkpoint?.deletedCount ?? 0);
      for (;;) {
        const rows = await listCmsResourcesAfter(payload.siteId, lastId, 100);
        if (rows.length === 0) break;
        for (const row of rows) {
          const refs = await listCmsResourceReferences(row.id);
          const orphan = isCmsResourceOrphan(refs);
          if (orphan) orphanCount += 1;
          if (orphan && payload.operation === 'cleanup' && !payload.dryRun) {
            await deleteCmsOrphanResource(row);
            deletedCount += 1;
          }
          await ctx.reportItems([{
            key: `resource-${row.id}`,
            label: row.name,
            status: orphan ? 'success' : 'skipped',
            message: orphan
              ? (payload.operation === 'cleanup' && !payload.dryRun ? '孤立素材已清理' : '孤立素材')
              : `存在 ${refs.length} 处引用`,
            data: {
              siteId: payload.siteId,
              resourceId: row.id,
              url: row.url,
              orphan,
              references: refs.length,
              operation: payload.operation,
              dryRun: payload.dryRun,
            },
          }]);
          processed += 1;
          lastId = row.id;
          const checkpoint = { lastId, processed, orphanCount, deletedCount };
          const { cancelRequested } = await ctx.progress({
            processed,
            total,
            note: `已扫描 ${processed}/${total}，孤立 ${orphanCount}，清理 ${deletedCount}`,
            checkpoint,
          });
          if (cancelRequested) return { operation: payload.operation, processed, total, orphanCount, deletedCount, dryRun: payload.dryRun };
        }
      }
      return { operation: payload.operation, processed, total, orphanCount, deletedCount, dryRun: payload.dryRun };
    },
  });
}
