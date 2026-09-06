import { uniquePositiveInts } from '@zenith/shared/core';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  cmsAds, cmsAdSlots, cmsChannels, cmsContents, cmsContentVersions, cmsForms,
  cmsFriendLinks, cmsPages, cmsResources, cmsSites,
} from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import {
  deleteCmsOrphanResource, listCmsResourcesAfter, listCmsSiteOrphanResourceIds, moveCmsResources,
} from './cms-resources.service';
import { syncCmsResourceRefs } from './cms-resource-refs.service';
import { assertSiteAccess } from './cms-sites.service';
import type { CmsResourceTaskPayload as GovernancePayload } from './cms-resource-task-submit.service';

export const CMS_RESOURCE_GOVERNANCE_TASK = 'cms-resource-governance';
export const CMS_RESOURCE_REF_REBUILD_TASK = 'cms-resource-ref-rebuild';

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
        const ids = uniquePositiveInts(payload.resourceIds);
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

      // 孤立判定由 cms_resource_refs 索引一次查全（旧实现是逐素材对 9 张表做全表 LIKE 扫描）
      const total = await db.$count(cmsResources, eq(cmsResources.siteId, payload.siteId));
      const orphanIds = await listCmsSiteOrphanResourceIds(payload.siteId);
      const orphanSet = new Set(orphanIds);
      let lastId = Number(ctx.checkpoint?.lastId ?? 0);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let orphanCount = Number(ctx.checkpoint?.orphanCount ?? 0);
      let deletedCount = Number(ctx.checkpoint?.deletedCount ?? 0);
      for (;;) {
        const rows = await listCmsResourcesAfter(payload.siteId, lastId, 100);
        if (rows.length === 0) break;
        for (const row of rows) {
          const orphan = orphanSet.has(row.id);
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
              : '存在站内引用',
            data: {
              siteId: payload.siteId,
              resourceId: row.id,
              url: row.url,
              orphan,
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

  registerTaskHandler({
    taskType: CMS_RESOURCE_REF_REBUILD_TASK,
    title: 'CMS 素材引用索引重建',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 3000,
    async run(ctx) {
      const siteId = Number((ctx.payload as { siteId?: number }).siteId);
      await assertSiteAccess(siteId);
      const stages = await buildRefRebuildStages(siteId);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      const total = stages.length;
      for (let index = processed; index < stages.length; index++) {
        const stage = stages[index];
        const count = await stage.run();
        await ctx.reportItems([{
          key: `stage-${stage.key}`,
          label: stage.label,
          status: 'success',
          message: `已重建 ${count} 个对象的引用`,
          data: { siteId, ownerType: stage.key, count },
        }]);
        processed = index + 1;
        const { cancelRequested } = await ctx.progress({
          processed,
          total,
          note: `${stage.label} 完成（${processed}/${total}）`,
          checkpoint: { processed },
        });
        if (cancelRequested) return { siteId, processed, total, cancelled: true };
      }
      return { siteId, processed, total };
    },
  });
}

/**
 * 按 owner 类型分批重建站点内的素材引用索引。
 *
 * 用途有二：一是存量数据首次接入句柄化后的回填，二是当引用索引被怀疑漂移时的修复工具。
 * 每个 owner 独立重建，失败可单独重试。
 */
async function buildRefRebuildStages(siteId: number): Promise<{ key: string; label: string; run: () => Promise<number> }[]> {
  const rebuild = async <T extends { id: number }>(
    ownerType: Parameters<typeof syncCmsResourceRefs>[1],
    rows: readonly T[],
  ): Promise<number> => {
    await db.transaction(async (tx) => {
      for (const row of rows) await syncCmsResourceRefs(tx, ownerType, row.id, siteId, row);
    });
    return rows.length;
  };

  return [
    {
      key: 'site',
      label: '站点配置',
      run: async () => rebuild('site', await db.select().from(cmsSites).where(eq(cmsSites.id, siteId))),
    },
    {
      key: 'channel',
      label: '栏目',
      run: async () => rebuild('channel', await db.select().from(cmsChannels).where(eq(cmsChannels.siteId, siteId))),
    },
    {
      key: 'content',
      label: '内容',
      run: async () => rebuild('content', await db.select().from(cmsContents).where(eq(cmsContents.siteId, siteId))),
    },
    {
      key: 'contentVersion',
      label: '内容版本快照',
      run: async () => rebuild('contentVersion', await db.select({ id: cmsContentVersions.id, snapshot: cmsContentVersions.snapshot })
        .from(cmsContentVersions)
        .innerJoin(cmsContents, eq(cmsContentVersions.contentId, cmsContents.id))
        .where(eq(cmsContents.siteId, siteId))),
    },
    {
      key: 'friendLink',
      label: '友情链接',
      run: async () => rebuild('friendLink', await db.select().from(cmsFriendLinks).where(eq(cmsFriendLinks.siteId, siteId))),
    },
    {
      key: 'ad',
      label: '广告',
      run: async () => rebuild('ad', await db.select({ id: cmsAds.id, image: cmsAds.image, linkUrl: cmsAds.linkUrl })
        .from(cmsAds)
        .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
        .where(eq(cmsAdSlots.siteId, siteId))),
    },
    {
      key: 'page',
      label: '搭建页面',
      run: async () => rebuild('page', await db.select().from(cmsPages).where(eq(cmsPages.siteId, siteId))),
    },
    {
      key: 'form',
      label: '表单',
      run: async () => rebuild('form', await db.select().from(cmsForms).where(eq(cmsForms.siteId, siteId))),
    },
  ];
}
