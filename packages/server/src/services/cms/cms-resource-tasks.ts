import { uniquePositiveInts } from '@zenith/shared/core';
import type { CmsResourceOwnerType } from '@zenith/shared/cms';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import {
  cmsAds, cmsAdSlots, cmsChannels, cmsContents, cmsContentVersions, cmsForms,
  cmsFriendLinks, cmsPages, cmsResources, cmsSites,
} from '../../db/schema';
import { registerTaskHandler } from '../../lib/task-center';
import {
  deleteCmsOrphanResource, listCmsResourcesAfter, listCmsSiteOrphanResourceIds, moveCmsResources,
} from './cms-resources.service';
import { CMS_RESOURCE_OWNER_FIELDS, rebuildCmsResourceRefsForOwners } from './cms-resource-refs.service';
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
      const stages = buildRefRebuildStages(siteId);
      const total = stages.length;
      // 断点：processed = 已完成的阶段数；cursor / stageCount = 当前阶段已重建到的 owner id 与计数
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let cursor = Number(ctx.checkpoint?.cursor ?? 0);
      let stageCount = Number(ctx.checkpoint?.stageCount ?? 0);
      for (let index = processed; index < stages.length; index++) {
        const stage = stages[index];
        for (;;) {
          const rows = await stage.fetchAfter(cursor, REF_REBUILD_CHUNK_SIZE);
          if (rows.length === 0) break;
          // 每片一个短事务：分片内的 owner 原子替换引用行，片与片之间不持锁，也不把整站正文装进内存
          await db.transaction((tx) => rebuildCmsResourceRefsForOwners(
            tx, stage.ownerType, siteId, rows.map((row) => ({ ownerId: row.id, row })),
          ));
          cursor = rows[rows.length - 1].id;
          stageCount += rows.length;
          const { cancelRequested } = await ctx.progress({
            processed: index,
            total,
            note: `${stage.label} 已重建 ${stageCount} 个对象（${index + 1}/${total}）`,
            checkpoint: { processed: index, cursor, stageCount },
          });
          if (cancelRequested) return { siteId, processed: index, total, cancelled: true };
          if (rows.length < REF_REBUILD_CHUNK_SIZE) break;
        }
        await ctx.reportItems([{
          key: `stage-${stage.key}`,
          label: stage.label,
          status: 'success',
          message: `已重建 ${stageCount} 个对象的引用`,
          data: { siteId, ownerType: stage.key, count: stageCount },
        }]);
        processed = index + 1;
        cursor = 0;
        stageCount = 0;
        const { cancelRequested } = await ctx.progress({
          processed,
          total,
          note: `${stage.label} 完成（${processed}/${total}）`,
          checkpoint: { processed, cursor, stageCount },
        });
        if (cancelRequested) return { siteId, processed, total, cancelled: true };
      }
      return { siteId, processed, total };
    },
  });
}

/** 引用重建每个事务处理的 owner 行数：内容行带正文，取小一点让单片内存与锁持有时间都可控 */
const REF_REBUILD_CHUNK_SIZE = 200;

type OwnerRow = { id: number } & Record<string, unknown>;

interface RefRebuildStage {
  key: string;
  label: string;
  ownerType: CmsResourceOwnerType;
  /** 按 id 升序取 `afterId` 之后的一片 owner 行，只含 id 与承载素材引用的字段 */
  fetchAfter: (afterId: number, limit: number) => Promise<OwnerRow[]>;
}

/**
 * 只投影 id 与 {@link CMS_RESOURCE_OWNER_FIELDS} 声明的承载字段：重建不需要整行，
 * 内容表的其余大列（检索向量等）不必进入内存。字段名以 owner 表列名为准，缺列即抛错暴露漂移。
 */
function ownerColumns(table: PgTable, ownerType: CmsResourceOwnerType): Record<string, PgColumn> {
  const columns = table as unknown as Record<string, PgColumn | undefined>;
  return Object.fromEntries(['id', ...CMS_RESOURCE_OWNER_FIELDS[ownerType]].map((name) => {
    const column = columns[name];
    if (!column) throw new Error(`CMS_RESOURCE_OWNER_FIELDS.${ownerType} 引用了不存在的列 ${name}`);
    return [name, column];
  }));
}

/**
 * 按 owner 类型分阶段重建站点内的素材引用索引，每阶段再按 id 游标分片。
 *
 * 用途有二：一是存量数据首次接入句柄化后的回填，二是当引用索引被怀疑漂移时的修复工具。
 * 各阶段互不依赖，断点落在「阶段 + 游标」上，中断后从上次提交的分片之后续跑。
 * xecutor 默认全局池，测试可传入事务执行器。
 */
export function buildRefRebuildStages(siteId: number, executor: DbExecutor = db): RefRebuildStage[] {
  const bySite = <T extends PgTable & { id: PgColumn; siteId: PgColumn }>(
    key: string, label: string, ownerType: CmsResourceOwnerType, table: T,
  ): RefRebuildStage => ({
    key,
    label,
    ownerType,
    fetchAfter: (afterId, limit) => executor.select(ownerColumns(table, ownerType)).from(table as PgTable)
      .where(and(eq(table.siteId, siteId), gt(table.id, afterId)))
      .orderBy(asc(table.id))
      .limit(limit) as unknown as Promise<OwnerRow[]>,
  });

  return [
    {
      key: 'site',
      label: '站点配置',
      ownerType: 'site',
      fetchAfter: (afterId, limit) => executor.select(ownerColumns(cmsSites, 'site')).from(cmsSites)
        .where(and(eq(cmsSites.id, siteId), gt(cmsSites.id, afterId)))
        .limit(limit) as unknown as Promise<OwnerRow[]>,
    },
    bySite('channel', '栏目', 'channel', cmsChannels),
    bySite('content', '内容', 'content', cmsContents),
    {
      key: 'contentVersion',
      label: '内容版本快照',
      ownerType: 'contentVersion',
      fetchAfter: (afterId, limit) => executor.select(ownerColumns(cmsContentVersions, 'contentVersion')).from(cmsContentVersions)
        .innerJoin(cmsContents, eq(cmsContentVersions.contentId, cmsContents.id))
        .where(and(eq(cmsContents.siteId, siteId), gt(cmsContentVersions.id, afterId)))
        .orderBy(asc(cmsContentVersions.id))
        .limit(limit) as unknown as Promise<OwnerRow[]>,
    },
    bySite('friendLink', '友情链接', 'friendLink', cmsFriendLinks),
    {
      key: 'ad',
      label: '广告',
      ownerType: 'ad',
      fetchAfter: (afterId, limit) => executor.select(ownerColumns(cmsAds, 'ad')).from(cmsAds)
        .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
        .where(and(eq(cmsAdSlots.siteId, siteId), gt(cmsAds.id, afterId)))
        .orderBy(asc(cmsAds.id))
        .limit(limit) as unknown as Promise<OwnerRow[]>,
    },
    bySite('page', '搭建页面', 'page', cmsPages),
    bySite('form', '表单', 'form', cmsForms),
  ];
}
