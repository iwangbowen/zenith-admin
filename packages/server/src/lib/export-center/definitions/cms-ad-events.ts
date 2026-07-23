import { db } from '../../../db';
import { cmsAdEvents } from '../../../db/schema';
import { CMS_AD_EVENT_TYPE_LABELS } from '@zenith/shared';
import {
  buildCmsAdEventWhere,
  streamCmsAdEvents,
  type ListCmsAdEventsQuery,
} from '../../../services/cms/cms-ad-events.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../../services/cms/cms-sites.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

interface AdEventExportRow extends Record<string, unknown> {
  id: number;
  siteName: string;
  adName: string;
  slotName: string;
  eventType: string;
  occurredAt: string;
  device: string;
  publishChannelName: string;
  path: string;
  referrer: string;
  visitorHash: string;
  ipHash: string;
  memberId: number | null;
  userAgent: string;
}

async function* exportRows(
  query: Omit<ListCmsAdEventsQuery, 'page' | 'pageSize'>,
): AsyncGenerator<AdEventExportRow> {
  for await (const row of streamCmsAdEvents(query)) {
    yield {
      id: row.id,
      siteName: row.siteName ?? String(row.siteId),
      adName: row.adName ?? String(row.adId),
      slotName: row.slotName ?? String(row.slotId),
      eventType: CMS_AD_EVENT_TYPE_LABELS[row.eventType],
      occurredAt: row.occurredAt,
      device: row.device,
      publishChannelName: row.publishChannelName ?? '',
      path: row.path ?? '',
      referrer: row.referrer ?? '',
      visitorHash: row.visitorHash,
      ipHash: row.ipHash,
      memberId: row.memberId,
      userAgent: row.userAgent ?? '',
    };
  }
}

function queryOf(query: Record<string, unknown>): Omit<ListCmsAdEventsQuery, 'page' | 'pageSize'> {
  return {
    siteId: Number(query.siteId),
    adId: query.adId ? Number(query.adId) : undefined,
    slotId: query.slotId ? Number(query.slotId) : undefined,
    eventType: query.eventType === 'impression' || query.eventType === 'click' ? query.eventType : undefined,
    device: ['pc', 'mobile', 'bot'].includes(String(query.device))
      ? query.device as 'pc' | 'mobile' | 'bot'
      : undefined,
    publishChannelId: query.publishChannelId ? Number(query.publishChannelId) : undefined,
    startTime: typeof query.startTime === 'string' ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' ? query.endTime : undefined,
  };
}

const columns: ExportColumn<AdEventExportRow>[] = [
  { key: 'id', header: '事件 ID', width: 12, type: 'number' },
  { key: 'siteName', header: '站点', width: 20 },
  { key: 'adName', header: '广告', width: 24 },
  { key: 'slotName', header: '广告位', width: 20 },
  { key: 'eventType', header: '事件类型', width: 12 },
  { key: 'occurredAt', header: '发生时间', width: 22, type: 'datetime' },
  { key: 'device', header: '设备', width: 12 },
  { key: 'publishChannelName', header: '发布通道', width: 18 },
  { key: 'path', header: '页面路径', width: 36 },
  { key: 'referrer', header: '来源', width: 40 },
  { key: 'visitorHash', header: '访客哈希', width: 34, sensitive: true },
  { key: 'ipHash', header: 'IP 哈希', width: 34, sensitive: true },
  { key: 'memberId', header: '会员 ID', width: 12, type: 'number', sensitive: true },
  { key: 'userAgent', header: 'User-Agent', width: 48 },
];

export const cmsAdEventsExportDefinition = defineExport<Record<string, unknown>, AdEventExportRow>({
  entity: 'cms.ad-events',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS广告事件',
  sourcePath: '/cms/ads',
  sheetName: '广告事件',
  formats: ['xlsx', 'csv'],
  permissions: {
    export: 'cms:ad-event:export',
    exportRaw: 'cms:ad-event:export-raw',
    requireExportRawPermission: true,
  },
  execution: { mode: 'auto', syncMaxRows: 5000, forceAsyncWhenSensitive: true, forceAsyncWhenRaw: true, syncModeOverridesAsyncPolicies: false },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 1 },
  columns,
  countRows: async (query) => {
    const parsed = queryOf(query);
    await ensureCmsSiteExists(parsed.siteId);
    await assertSiteAccess(parsed.siteId);
    return db.$count(cmsAdEvents, buildCmsAdEventWhere(parsed));
  },
  streamRows: (query) => exportRows(queryOf(query)),
});
