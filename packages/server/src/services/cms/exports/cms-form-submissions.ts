import { desc, eq } from 'drizzle-orm';
import { db } from '../../../db/index';
import { cmsFormSubmissions } from '../../../db/schema';
import { formatDateTime } from '../../../lib/datetime';
import { ensureCmsFormExists } from '../cms-forms.service';
import { assertSiteAccess } from '../cms-sites.service';
import { defineExport } from '../../../lib/export-center/registry';
import { RETENTION_7_DAYS } from '../../../lib/export-center/presets';
import type { ExportColumn } from '../../../lib/export-center/types';

function asPositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 按表单字段定义动态生成导出列（每个自定义字段一列） */
async function resolveFormColumns(query: Record<string, unknown>): Promise<ExportColumn[]> {
  const base: ExportColumn[] = [
    { key: 'id', header: '提交ID', width: 10, type: 'number' },
    { key: 'createdAt', header: '提交时间', width: 22, type: 'datetime' },
    { key: 'ip', header: 'IP', width: 16 },
  ];
  const formId = asPositive(query.formId);
  if (!formId) return base;
  const form = await ensureCmsFormExists(formId);
  const fieldColumns: ExportColumn[] = (form.fields ?? []).map((f) => ({
    key: `field_${f.name}`,
    header: f.label,
    width: 24,
  }));
  return [base[0], ...fieldColumns, base[1], base[2]];
}

async function loadRows(query: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const formId = asPositive(query.formId);
  if (!formId) return [];
  const form = await ensureCmsFormExists(formId);
  await assertSiteAccess(form.siteId);
  const rows = await db.select().from(cmsFormSubmissions)
    .where(eq(cmsFormSubmissions.formId, formId))
    .orderBy(desc(cmsFormSubmissions.id))
    .limit(50_000);
  return rows.map((row) => {
    const flat: Record<string, unknown> = {
      id: row.id,
      createdAt: formatDateTime(row.createdAt),
      ip: row.ip ?? '',
    };
    for (const [key, value] of Object.entries(row.data ?? {})) {
      flat[`field_${key}`] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    return flat;
  });
}

export const cmsFormSubmissionsExportDefinition = defineExport<Record<string, unknown>, Record<string, unknown>>({
  entity: 'cms.form-submissions',
  moduleName: 'CMS内容管理',
  filenamePrefix: '表单提交数据',
  sourcePath: '/cms/forms',
  sheetName: '提交数据',
  formats: ['xlsx', 'csv'],
  permissions: { export: 'cms:form:manage' },
  execution: { mode: 'sync', syncMaxRows: 5000, syncModeOverridesAsyncPolicies: true },
  retention: RETENTION_7_DAYS,
  columns: [
    { key: 'id', header: '提交ID', width: 10, type: 'number' },
    { key: 'createdAt', header: '提交时间', width: 22, type: 'datetime' },
    { key: 'ip', header: 'IP', width: 16 },
  ],
  resolveColumns: (query) => resolveFormColumns(query),
  countRows: async (query) => {
    const formId = asPositive(query.formId);
    if (!formId) return 0;
    return db.$count(cmsFormSubmissions, eq(cmsFormSubmissions.formId, formId));
  },
  streamRows: async (query) => loadRows(query),
});
