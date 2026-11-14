import { formatExportCell } from './formatter';
import { currentUser } from '../context';
import { DEFAULT_EXPORT_RETENTION, type ExportRuntimeContext } from './types';
import { getExportMaskRuleMap } from '../../services/platform/data-mask.service';
import type { CreateExportJobInput } from '@zenith/shared/tasks';
import { prepareExport } from './prepare';
import { selectExportRows } from './scope';

/** Read-only preparation shares admission checks; samples are always masked. */
export async function previewExport(input: CreateExportJobInput) {
  const user = currentUser();
  const spec = await prepareExport(input, user);
  const { definition, query, columns, selectedColumns, sensitive, total, rowIds } = spec;
  const chosen = selectedColumns ? selectedColumns.map(key => columns.find(c => c.key === key)!) : columns;
  const sample: Array<Record<string, string | number | boolean | null>> = [];
  if (spec.supportsPartition && total !== null && total <= 5000) {
    const ctx: ExportRuntimeContext = { jobId: 0, entity: definition.entity, moduleName: definition.moduleName, format: spec.format, query, selectedColumns, raw: false, masked: true, sensitive, watermark: false, currentUser: user, createdByName: null, exportedAt: new Date(), maskRules: await getExportMaskRuleMap() };
    const rows = await definition.streamRows(query, user, ctx);
    let scanned = 0;
    async function* bounded() { for await (const row of rows) { if (++scanned > 5000) return; yield row; } }
    for await (const row of selectExportRows(bounded(), rowIds)) {
      if (sample.length < 3) sample.push(Object.fromEntries(chosen.map(column => { const value = formatExportCell(column, row, ctx); return [column.header, value == null ? null : typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 200)]; })));
      if (!rowIds && sample.length >= 3) break;
    }
  }
  const retention = { ...DEFAULT_EXPORT_RETENTION, ...definition.retention };
  return { entity: definition.entity, title: definition.filenamePrefix, formats: definition.formats ?? ['xlsx', 'csv'], columns: columns.map(c => ({ key: c.key ?? c.header, header: c.header, type: c.type, sensitive: !!c.sensitive, width: c.width })), sensitive, canExportRaw: spec.canExportRaw, maxRows: spec.execution.maxRows, syncMaxRows: spec.execution.syncMaxRows, estimatedRows: spec.rowCount, sample, retentionDays: spec.raw ? retention.rawDays : sensitive ? retention.sensitiveDays : retention.normalDays, executionMode: spec.executionMode, supportsRowScope: spec.supportsRowScope, supportsColumns: spec.supportsColumns, supportsPartition: spec.supportsPartition };
}
