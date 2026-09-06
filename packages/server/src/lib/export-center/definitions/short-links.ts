import { desc } from 'drizzle-orm';
import { db } from '../../../db';
import { shortLinks } from '../../../db/schema';
import { batchIterable } from '../../excel-export';
import { currentUser } from '../../context';
import { tenantCondition } from '../../tenant';
import { defineExport } from '../registry';
import { RETENTION_7_DAYS } from '../presets';
import {
  COMMON_STATUS_LABELS,
} from '@zenith/shared/core';
import {
  SHORT_LINK_BIZ_TYPE_LABELS,
  SHORT_LINK_REDIRECT_TYPE_LABELS,
} from '@zenith/shared/short-link';
import { buildShortUrl } from '../../../services/short-link/short-link.service';
import type { ExportColumn } from '../types';

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'code', header: '短码', width: 14 },
  { key: 'shortUrl', header: '短链地址', width: 40 },
  { key: 'targetUrl', header: '目标地址', width: 60 },
  { key: 'title', header: '标题', width: 24 },
  { key: 'redirectType', header: '跳转方式', width: 14, enumMap: SHORT_LINK_REDIRECT_TYPE_LABELS },
  { key: 'status', header: '状态', width: 10, enumMap: COMMON_STATUS_LABELS },
  { key: 'bizType', header: '来源业务', width: 12, enumMap: SHORT_LINK_BIZ_TYPE_LABELS },
  { key: 'totalPv', header: '累计访问', width: 12, type: 'number' },
  { key: 'expiresAt', header: '过期时间', width: 22, type: 'datetime' },
  { key: 'lastVisitAt', header: '最近访问', width: 22, type: 'datetime' },
  { key: 'remark', header: '备注', width: 30 },
  { key: 'createdAt', header: '创建时间', width: 22, type: 'datetime' },
];

export const shortLinksExportDefinition = defineExport({
  entity: 'shortlink.links',
  moduleName: '短链管理',
  filenamePrefix: '短链列表',
  sourcePath: '/growth/short-links',
  sheetName: '短链列表',
  permissions: { export: 'shortlink:link:export' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns,
  countRows: async () => db.$count(shortLinks, tenantCondition(shortLinks, currentUser())),
  streamRows: async () => {
    const where = tenantCondition(shortLinks, currentUser());
    return batchIterable(async (limit, offset) => {
      const rows = await db.select().from(shortLinks).where(where).orderBy(desc(shortLinks.id)).limit(limit).offset(offset);
      return rows.map((r) => ({ ...r, shortUrl: buildShortUrl(r.code) }));
    });
  },
});
