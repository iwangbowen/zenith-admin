import { db } from '../../../db';
import { cmsMemberSubscriptions } from '../../../db/schema';
import { CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS } from '@zenith/shared';
import {
  buildCmsSubscriptionWhere,
  streamCmsSubscriptions,
  type ListCmsSubscriptionsQuery,
} from '../../../services/cms/cms-subscriptions.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../../services/cms/cms-sites.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

interface SubscriptionExportRow extends Record<string, unknown> {
  id: number;
  memberDisplay: string;
  siteName: string;
  subjectType: string;
  subjectLabel: string;
  notificationEnabled: boolean;
  createdAt: string;
}

async function* exportRows(
  query: Omit<ListCmsSubscriptionsQuery, 'page' | 'pageSize'>,
): AsyncGenerator<SubscriptionExportRow> {
  for await (const row of streamCmsSubscriptions(query)) {
    yield {
      id: row.id,
      memberDisplay: row.memberDisplay ?? '',
      siteName: row.siteName ?? String(row.siteId),
      subjectType: CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[row.subjectType],
      subjectLabel: row.subjectLabel,
      notificationEnabled: row.notificationEnabled,
      createdAt: row.createdAt,
    };
  }
}

function queryOf(query: Record<string, unknown>): Omit<ListCmsSubscriptionsQuery, 'page' | 'pageSize'> {
  return {
    siteId: Number(query.siteId),
    subjectType: ['site', 'channel', 'author'].includes(String(query.subjectType))
      ? query.subjectType as 'site' | 'channel' | 'author'
      : undefined,
    subjectKeyword: typeof query.subjectKeyword === 'string' ? query.subjectKeyword : undefined,
    startTime: typeof query.startTime === 'string' ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' ? query.endTime : undefined,
  };
}

const columns: ExportColumn<SubscriptionExportRow>[] = [
  { key: 'id', header: '订阅 ID', width: 12, type: 'number' },
  { key: 'memberDisplay', header: '会员（脱敏）', width: 20, sensitive: true },
  { key: 'siteName', header: '站点', width: 20 },
  { key: 'subjectType', header: '对象类型', width: 12 },
  { key: 'subjectLabel', header: '订阅对象', width: 28 },
  { key: 'notificationEnabled', header: '通知开启', width: 12, type: 'boolean' },
  { key: 'createdAt', header: '订阅时间', width: 22, type: 'datetime' },
];

export const cmsSubscriptionsExportDefinition = defineExport<Record<string, unknown>, SubscriptionExportRow>({
  entity: 'cms.subscriptions',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS会员订阅',
  sourcePath: '/cms/subscriptions',
  sheetName: '订阅明细',
  formats: ['xlsx', 'csv'],
  permissions: {
    export: 'cms:subscription:export',
    exportRaw: 'cms:subscription:export-raw',
    requireExportRawPermission: true,
  },
  execution: { mode: 'auto', syncMaxRows: 5000, forceAsyncWhenSensitive: true, forceAsyncWhenRaw: false, syncModeOverridesAsyncPolicies: false },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 3 },
  columns,
  countRows: async (query) => {
    const parsed = queryOf(query);
    await ensureCmsSiteExists(parsed.siteId);
    await assertSiteAccess(parsed.siteId);
    return db.$count(cmsMemberSubscriptions, buildCmsSubscriptionWhere(parsed));
  },
  streamRows: (query) => exportRows(queryOf(query)),
});
