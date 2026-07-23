import { db } from '../../../db';
import { cmsInteractionResponses, cmsInteractions } from '../../../db/schema';
import { CMS_INTERACTION_KIND_LABELS } from '@zenith/shared';
import {
  buildCmsInteractionResponseWhere,
  streamCmsInteractionResponses,
  type ListCmsInteractionResponsesQuery,
} from '../../../services/cms/cms-interactions.service';
import { assertSiteAccess, ensureCmsSiteExists } from '../../../services/cms/cms-sites.service';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';
import { eq, sql } from 'drizzle-orm';

interface InteractionResponseExportRow extends Record<string, unknown> {
  id: number;
  interactionTitle: string;
  kind: string;
  memberDisplay: string;
  answers: string;
  visitorHash: string;
  ipHash: string;
  createdAt: string;
}

async function* exportRows(
  query: Omit<ListCmsInteractionResponsesQuery, 'page' | 'pageSize'>,
): AsyncGenerator<InteractionResponseExportRow> {
  for await (const row of streamCmsInteractionResponses(query)) {
    yield {
      id: row.id,
      interactionTitle: row.interactionTitle ?? '',
      kind: row.kind ? CMS_INTERACTION_KIND_LABELS[row.kind] : '',
      memberDisplay: row.memberDisplay ?? '游客',
      answers: JSON.stringify(row.answers),
      visitorHash: row.visitorHash,
      ipHash: row.ipHash,
      createdAt: row.createdAt,
    };
  }
}

function queryOf(query: Record<string, unknown>): Omit<ListCmsInteractionResponsesQuery, 'page' | 'pageSize'> {
  return {
    siteId: Number(query.siteId),
    interactionId: query.interactionId ? Number(query.interactionId) : undefined,
    kind: query.kind === 'survey' || query.kind === 'poll' ? query.kind : undefined,
    startTime: typeof query.startTime === 'string' ? query.startTime : undefined,
    endTime: typeof query.endTime === 'string' ? query.endTime : undefined,
  };
}

const columns: ExportColumn<InteractionResponseExportRow>[] = [
  { key: 'id', header: '答卷 ID', width: 12, type: 'number' },
  { key: 'interactionTitle', header: '互动问卷', width: 30 },
  { key: 'kind', header: '类型', width: 10 },
  { key: 'memberDisplay', header: '参与者（脱敏）', width: 20, sensitive: true },
  { key: 'answers', header: '答案 JSON', width: 60, sensitive: true },
  { key: 'visitorHash', header: '访客哈希', width: 34, sensitive: true },
  { key: 'ipHash', header: 'IP 哈希', width: 34, sensitive: true },
  { key: 'createdAt', header: '提交时间', width: 22, type: 'datetime' },
];

export const cmsInteractionResponsesExportDefinition = defineExport<Record<string, unknown>, InteractionResponseExportRow>({
  entity: 'cms.interaction-responses',
  moduleName: 'CMS内容管理',
  filenamePrefix: 'CMS互动答卷',
  sourcePath: '/cms/interactions',
  sheetName: '互动答卷',
  formats: ['xlsx', 'csv'],
  permissions: {
    export: 'cms:interaction:export',
    exportRaw: 'cms:interaction:export-raw',
    requireExportRawPermission: true,
  },
  execution: { mode: 'auto', syncMaxRows: 3000, forceAsyncWhenSensitive: true, forceAsyncWhenRaw: true, syncModeOverridesAsyncPolicies: false },
  retention: { normalDays: 7, sensitiveDays: 3, rawDays: 1 },
  columns,
  countRows: async (query) => {
    const parsed = queryOf(query);
    await ensureCmsSiteExists(parsed.siteId);
    await assertSiteAccess(parsed.siteId);
    const [row] = await db.select({ total: sql<number>`count(*)::int` })
      .from(cmsInteractionResponses)
      .innerJoin(cmsInteractions, eq(cmsInteractionResponses.interactionId, cmsInteractions.id))
      .where(buildCmsInteractionResponseWhere(parsed));
    return row?.total ?? 0;
  },
  streamRows: (query) => exportRows(queryOf(query)),
});
