import { HTTPException } from 'hono/http-exception';
import { leafColumns } from './writer';
import { formatExportCell } from './formatter';
import { getExportDefinition } from './registry';
import { currentUser } from '../context';
import { getUserPermissions, isSuperAdmin } from '../permissions';
import { DEFAULT_EXPORT_EXECUTION, DEFAULT_EXPORT_RETENTION, type ExportRuntimeContext } from './types';
import { getExportMaskRuleMap } from '../../services/platform/data-mask.service';
import type { CreateExportJobInput } from '@zenith/shared/tasks';
/** Read-only configuration preparation. Samples always pass through export masking. */
export async function previewExport(input: CreateExportJobInput) {
  const user = currentUser();
  const definition = getExportDefinition(input.entity);
  const permissions = await getUserPermissions(user.userId);
  const allowed = (permission?: string) => !!permission && (isSuperAdmin(user) || permissions.includes(permission));
  if (!allowed(definition.permissions.export)) throw new HTTPException(403, { message: '无导出权限' });
  const canExportRaw = allowed(definition.permissions.exportRaw);
  if (input.raw && !canExportRaw) throw new HTTPException(403, { message: '无明文导出权限' });
  const query = definition.prepareQuery ? await definition.prepareQuery(input.query, user) : input.query;
  const columns = leafColumns(definition.resolveColumns ? await definition.resolveColumns(query, user) : definition.columns);
  const chosen = input.columns ? input.columns.map(key => columns.find(c => c.key === key)).filter(c => c !== undefined) : columns;
  if (input.columns && chosen.length !== input.columns.length) throw new HTTPException(400, { message: '导出字段不存在' });
  const sensitive = chosen.some(c => c.sensitive);
  const total = definition.withSnapshot ? null : await definition.countRows(query, user);
  const supportsRowScope = (definition.renderMode ?? 'table') === 'table' && !definition.withSnapshot && columns.some(c => c.key === 'id');
  const rowIds = input.scope !== 'filtered' ? input.rowIds ?? [] : null;
  if (rowIds && (!rowIds.length || !supportsRowScope)) throw new HTTPException(400, { message: '当前导出范围不可用' });
  const sample: Array<Record<string, string | number | boolean | null>> = [];
  if ((definition.renderMode ?? 'table') === 'table' && !definition.withSnapshot && total !== null && total <= 5000) {
    const ctx: ExportRuntimeContext = { jobId: 0, entity: definition.entity, moduleName: definition.moduleName, format: input.format, query, selectedColumns: input.columns ?? null, raw: input.raw, masked: !input.raw, sensitive, watermark: false, currentUser: user, createdByName: null, exportedAt: new Date(), maskRules: await getExportMaskRuleMap() };
    const rows = await definition.streamRows(query, user, ctx);
    for await (const row of rows) {
      if (rowIds && !rowIds.some(id => String(id) === String(row.id))) continue;
      sample.push(Object.fromEntries(chosen.map(column => { const value = formatExportCell(column, row, ctx); return [column.header, value == null ? null : typeof value === 'number' || typeof value === 'boolean' ? value : String(value).slice(0, 200)]; })));
      if (sample.length >= 3) break;
    }
  }
  const execution = { ...DEFAULT_EXPORT_EXECUTION, ...definition.execution };
  const retention = { ...DEFAULT_EXPORT_RETENTION, ...definition.retention };
  const estimatedRows = rowIds ? rowIds.length : total;
  const async = !!definition.withSnapshot || execution.mode === 'async' || input.executionMode === 'async' || (estimatedRows ?? 0) > execution.syncMaxRows || (sensitive && execution.forceAsyncWhenSensitive) || (input.raw && execution.forceAsyncWhenRaw);
  return { entity: definition.entity, title: definition.filenamePrefix, formats: definition.formats ?? ['xlsx', 'csv'], columns: columns.map(c => ({ key: c.key ?? c.header, header: c.header, type: c.type, sensitive: !!c.sensitive, width: c.width })), sensitive, canExportRaw, maxRows: execution.maxRows, syncMaxRows: execution.syncMaxRows, estimatedRows, sample, retentionDays: input.raw ? retention.rawDays : sensitive ? retention.sensitiveDays : retention.normalDays, executionMode: async ? 'async' as const : 'sync' as const, supportsRowScope };
}

