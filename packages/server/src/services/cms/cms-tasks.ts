import { registerTaskHandler } from '../../lib/task-center';
import { buildSiteStatic, ensureCmsStaticBuildAccess } from './cms-static.service';
import { rebuildSearchIndex } from './cms-search.service';
import { registerCmsDeadlinkTaskHandler } from './cms-deadlink.service';
import { registerCmsCollectTaskHandler } from './cms-collect.service';
import { createCmsContent, ensureCmsContentTargetAccess } from './cms-contents.service';
import { readFileContent } from '../files/files.service';
import { isCmsPlatformAdmin } from './cms-access';
import { assertAllCmsSiteChannelsAccess } from './cms-channels.service';
import { registerCmsResourceTaskHandler } from './cms-resource-tasks';
import { registerCmsThemeTaskHandler } from './cms-themes.service';
import { registerCmsPublishingTaskHandler } from './cms-publishing.service';
import { registerCmsStage4TaskHandlers } from './cms-stage4-tasks';

/** CMS 任务中心 handler 注册（index.ts 启动流程中、registerSystemTasks 之前调用） */
export function registerCmsTaskHandlers(): void {
  registerCmsDeadlinkTaskHandler();
  registerCmsCollectTaskHandler();
  registerCmsContentImportTaskHandler();
  registerCmsResourceTaskHandler();
  registerCmsThemeTaskHandler();
  registerCmsPublishingTaskHandler();
  registerCmsStage4TaskHandlers();
  registerTaskHandler({
    taskType: 'cms-static-build',
    title: 'CMS 全站静态化',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const payload = ctx.payload as { siteId?: number };
      const siteId = Number(payload.siteId);
      if (!siteId) throw new Error('缺少 siteId 参数');
      await ensureCmsStaticBuildAccess(siteId);
      const result = await buildSiteStatic(siteId, async (p) => {
        const { cancelRequested } = await ctx.progress({
          processed: p.processed,
          total: p.total,
          note: p.note,
          checkpoint: { ...p.checkpoint },
        });
        return cancelRequested;
      }, { resumeAfterKey: typeof ctx.checkpoint?.lastKey === 'string' ? ctx.checkpoint.lastKey : null });
      return { pages: result.pages };
    },
  });

  // 主题代码变更自动重建（cms-theme-watch.service 检测指纹变化后提交）：单任务串行重建多站点
  registerTaskHandler({
    taskType: 'cms-theme-rebuild',
    title: 'CMS 主题变更重建',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const siteIds = [...new Set(((ctx.payload as { siteIds?: number[] })?.siteIds ?? [])
        .filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
      if (siteIds.length === 0) throw new Error('缺少 siteIds 参数');
      let pages = 0;
      const lastSiteId = Number(ctx.checkpoint?.lastSiteId ?? 0);
      let completedSiteId = lastSiteId;
      let completed = siteIds.filter((id) => id <= lastSiteId).length;
      for (const siteId of siteIds) {
        if (siteId <= lastSiteId) continue;
        await ensureCmsStaticBuildAccess(siteId);
        const resumeAfterKey = Number(ctx.checkpoint?.currentSiteId) === siteId && typeof ctx.checkpoint?.lastKey === 'string'
          ? ctx.checkpoint.lastKey
          : null;
        const result = await buildSiteStatic(siteId, async (p) => {
          const { cancelRequested } = await ctx.progress({
            processed: completed,
            total: siteIds.length,
            note: `站点 ${completed + 1}/${siteIds.length}：${p.note}`,
            checkpoint: {
              phase: 'legacy-theme-site',
              lastSiteId: completedSiteId,
              currentSiteId: siteId,
              lastKey: p.checkpoint.lastKey,
            },
          });
          return cancelRequested;
        }, { resumeAfterKey });
        pages += result.pages;
        completed += 1;
        completedSiteId = siteId;
        const { cancelRequested } = await ctx.progress({
          processed: completed,
          total: siteIds.length,
          note: `站点 ${completed}/${siteIds.length} 完成`,
          checkpoint: { phase: 'legacy-theme-site', lastSiteId: siteId, currentSiteId: null, lastKey: null },
        });
        if (cancelRequested) return { pages, sites: completed };
      }
      return { pages, sites: siteIds.length };
    },
  });

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
      return { processed: processedBefore + processed };
    },
  });
}

/**
 * 内容 Excel 批量导入：读取文件中心 xlsx（首行表头：标题|摘要|正文|作者|来源），
 * 逐行创建草稿内容，行级明细报告 + 断点续跑。
 */
function registerCmsContentImportTaskHandler(): void {
  registerTaskHandler({
    taskType: 'cms-content-import',
    title: 'CMS 内容批量导入',
    module: 'CMS内容管理',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const payload = ctx.payload as { fileId?: string; siteId?: number; channelId?: number };
      const { fileId, siteId, channelId } = payload;
      if (!fileId || !siteId || !channelId) throw new Error('缺少 fileId / siteId / channelId 参数');
      await ensureCmsContentTargetAccess(siteId, channelId);

      const { default: ExcelJS } = await import('exceljs');
      const stored = await readFileContent(fileId);
      const arrayBuffer = await new Response(stored.stream).arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error('Excel 文件无工作表');

      // 首行表头：按列名定位（标题必填，其余可选）
      const headerMap = new Map<string, number>();
      sheet.getRow(1).eachCell((cell, colNumber) => {
        headerMap.set(String(cell.value ?? '').trim(), colNumber);
      });
      const titleCol = headerMap.get('标题');
      if (!titleCol) throw new Error('Excel 首行必须包含「标题」列（可选列：摘要/正文/作者/来源）');
      const cellText = (rowIdx: number, header: string): string | null => {
        const col = headerMap.get(header);
        if (!col) return null;
        const value = sheet.getRow(rowIdx).getCell(col).value;
        if (value === null || value === undefined) return null;
        const text = typeof value === 'object' && 'richText' in (value as object)
          ? (value as { richText: { text: string }[] }).richText.map((r) => r.text).join('')
          : String(value);
        return text.trim() || null;
      };

      const totalRows = sheet.rowCount - 1;
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      let succeeded = Number(ctx.checkpoint?.succeeded ?? 0);
      for (let i = processed; i < totalRows; i++) {
        const rowIdx = i + 2; // 数据从第 2 行开始
        const title = cellText(rowIdx, '标题');
        if (title) {
          try {
            await createCmsContent({
              siteId,
              channelId,
              title: title.slice(0, 255),
              summary: cellText(rowIdx, '摘要'),
              body: cellText(rowIdx, '正文'),
              author: cellText(rowIdx, '作者'),
              source: cellText(rowIdx, '来源'),
              extend: {},
              isTop: false,
              isRecommend: false,
              isHot: false,
              sort: 0,
              tagIds: [],
              extraChannelIds: [],
              relatedIds: [],
            });
            succeeded += 1;
            await ctx.reportItems([{ key: `row-${rowIdx}`, label: title.slice(0, 100), status: 'success', message: null }]);
          } catch (err) {
            await ctx.reportItems([{
              key: `row-${rowIdx}`,
              label: title.slice(0, 100),
              status: 'failed',
              message: err instanceof Error ? err.message.slice(0, 200) : '导入失败',
            }]);
          }
        } else {
          await ctx.reportItems([{ key: `row-${rowIdx}`, label: `第 ${rowIdx} 行`, status: 'failed', message: '标题为空，已跳过' }]);
        }
        processed = i + 1;
        const { cancelRequested } = await ctx.progress({
          processed,
          total: totalRows,
          note: `已导入 ${succeeded}/${processed} 行（共 ${totalRows} 行）`,
          checkpoint: { processed, succeeded },
        });
        if (cancelRequested) return;
      }
      return { processed, succeeded };
    },
  });
}
