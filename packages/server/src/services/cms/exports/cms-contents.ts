import { CMS_CONTENT_STATUS_LABELS, cmsContentListQuery } from '@zenith/shared/cms';
import { db } from '../../../db/index';
import { cmsContents } from '../../../db/schema';
import { buildCmsContentListWhere, loadCmsContentListRows, type CmsContentListFilter } from '../cms-contents-query.service';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import { DEFAULT_EXPORT_EXECUTION, type ExportColumn } from '../../../lib/export-center/types';

interface CmsContentExportRow extends Record<string, unknown> {
  id: number;
  title: string;
  channelName: string;
  author: string;
  source: string;
  statusText: string;
  flags: string;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
}

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'title', header: '标题', width: 40 },
  { key: 'channelName', header: '栏目', width: 16 },
  { key: 'author', header: '作者', width: 12 },
  { key: 'source', header: '来源', width: 12 },
  { key: 'statusText', header: '状态', width: 10 },
  { key: 'flags', header: '属性', width: 14 },
  { key: 'viewCount', header: '浏览量', width: 10, type: 'number' },
  { key: 'publishedAt', header: '发布时间', width: 22, type: 'datetime' },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

const filterSchema = cmsContentListQuery.omit({ page: true, pageSize: true });

/** JSON 导出参数按 HTTP 查询的标量形式解析；筛选集合直接派生自列表契约，避免逐字段漏传。 */
function normalizeQuery(query: Record<string, unknown>): CmsContentListFilter {
  return filterSchema.parse(Object.fromEntries(Object.entries(query)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => [key, typeof value === 'boolean' ? String(value) : value])));
}

async function loadRows(query: Record<string, unknown>): Promise<CmsContentExportRow[]> {
  // 比导出上限多读一行，让 writer 拒绝期间新增导致的超量，不能静默截断成成功导出。
  const rows = await loadCmsContentListRows(normalizeQuery(query), { limit: DEFAULT_EXPORT_EXECUTION.maxRows + 1 });
  return rows.map((content) => ({
    id: content.id,
    title: content.title,
    channelName: content.channelName ?? '',
    author: content.author ?? '',
    source: content.source ?? '',
    statusText: CMS_CONTENT_STATUS_LABELS[content.status] ?? content.status,
    flags: [content.isTop ? '置顶' : '', content.isRecommend ? '推荐' : '', content.isHot ? '热门' : ''].filter(Boolean).join('/'),
    viewCount: content.viewCount,
    publishedAt: content.publishedAt,
    createdAt: content.createdAt,
  }));
}

export const cmsContentsExportDefinition = defineExport<Record<string, unknown>, CmsContentExportRow>({
  entity: 'cms.contents',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS内容列表',
  sourcePath: '/cms/contents',
  sheetName: '内容列表',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:content:export' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  prepareQuery: async (query) => normalizeQuery(query),
  countRows: async (query) => db.$count(cmsContents, await buildCmsContentListWhere(normalizeQuery(query))),
  streamRows: async (query) => loadRows(query),
});
