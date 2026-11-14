import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import type { BodyOf } from '@zenith/shared/core';
import { exportJobContract } from '@zenith/shared/tasks';
import type { JwtPayload } from '../../middleware/auth';
import { getUserPermissions, isSuperAdmin } from '../permissions';
import { getSettings } from '../settings';
import { runWithOperationPermissions } from '../context';
import { getExportDefinition } from './registry';
import { leafColumns } from './writer';
import { DEFAULT_EXPORT_EXECUTION, type AnyExportDefinition } from './types';

export type ExportRequest = NonNullable<BodyOf<typeof exportJobContract.create>>;

export async function prepareExportQuery(definition: AnyExportDefinition, query: Record<string, unknown>, user: JwtPayload) {
  try { return definition.prepareQuery ? await definition.prepareQuery(query, user) : query; }
  catch (error) {
    if (error instanceof ZodError) throw new HTTPException(400, { message: '导出筛选参数无效：' + error.issues.map(issue => issue.path.join('.')).filter(Boolean).join('、'), cause: error });
    throw error;
  }
}

export async function assertExportPermission(definition: AnyExportDefinition, raw: boolean, user: JwtPayload) {
  const permissions = await getUserPermissions(user.userId);
  const allowed = (code?: string) => !!code && (isSuperAdmin(user) || permissions.includes(code));
  if (!allowed(definition.permissions.export)) throw new HTTPException(403, { message: '无导出权限' });
  if (raw && (definition.permissions.requireExportRawPermission || definition.resolveColumns || leafColumns(definition.columns).some(c => c.sensitive)) && !allowed(definition.permissions.exportRaw)) throw new HTTPException(403, { message: '无明文导出权限' });
}

/** The same authorized specification drives preview, admission and saved presets. */
export async function prepareExport(input: ExportRequest, user: JwtPayload) {
  const definition = getExportDefinition(input.entity);
  return runWithOperationPermissions([definition.permissions.export], () => prepareExportWithin(input, user));
}
async function prepareExportWithin(input: ExportRequest, user: JwtPayload) {
  const definition = getExportDefinition(input.entity);
  const policy = await getSettings('exports');
  const format = input.format ?? 'xlsx';
  const raw = input.raw ?? false;
  await assertExportPermission(definition, raw, user);
  const canExportRaw = !!definition.permissions.exportRaw && (isSuperAdmin(user) || (await getUserPermissions(user.userId)).includes(definition.permissions.exportRaw));
  if (!(definition.formats ?? ['xlsx', 'csv']).includes(format)) throw new HTTPException(400, { message: '该实体不支持所选格式' });
  if (definition.renderMode === 'layout') throw new HTTPException(400, { message: '暂不支持 layout 导出，请使用自定义渲染器' });
  const supportsColumns = (definition.renderMode ?? 'table') === 'table' && !definition.renderFile;
  const supportsPartition = supportsColumns && !definition.withSnapshot;
  if (format === 'csv' && !supportsColumns) throw new HTTPException(400, { message: '自定义文档不支持CSV格式' });
  if ((input.splitRows ?? 0) > 0 && (!supportsPartition || !['csv', 'xlsx'].includes(format))) throw new HTTPException(400, { message: '当前实体暂不支持分卷' });
  if (input.columns && !supportsColumns) throw new HTTPException(400, { message: '当前文档由模板决定布局，不支持自选字段' });
  const query = await prepareExportQuery(definition, input.query ?? {}, user);
  const columns = leafColumns(definition.resolveColumns ? await definition.resolveColumns(query, user) : definition.columns);
  const selectedColumns = input.columns ?? (supportsColumns && columns.length > 0 && columns.every(c => c.key) ? columns.map(c => c.key!) : null);
  if (selectedColumns && (new Set(selectedColumns).size !== selectedColumns.length || selectedColumns.some(key => !columns.some(c => c.key === key)))) throw new HTTPException(400, { message: '导出字段不存在或重复' });
  const chosen = selectedColumns ? selectedColumns.map(key => columns.find(c => c.key === key)!) : columns;
  if (chosen.length > policy.maxColumns) throw new HTTPException(400, { message: '所选列数超过导出治理预算' });
  const sensitive = chosen.some(c => c.sensitive);
  const supportsRowScope = supportsPartition && columns.some(c => c.key === 'id');
  const scope = input.scope ?? 'filtered';
  const rowIds = scope === 'filtered' ? null : [...new Map((input.rowIds ?? []).map(id => [String(id), id])).values()];
  if (rowIds && (!rowIds.length || !supportsRowScope)) throw new HTTPException(400, { message: '当前导出范围不可用' });
  const execution = { ...DEFAULT_EXPORT_EXECUTION, ...definition.execution };
  execution.maxRows = Math.min(execution.maxRows, policy.maxRows);
  execution.syncMaxRows = Math.min(execution.syncMaxRows, policy.syncMaxRows);
  const total = definition.withSnapshot ? null : await definition.countRows(query, user);
  const rowCount = rowIds ? rowIds.length : total;
  if (rowCount !== null && rowCount > execution.maxRows) throw new HTTPException(400, { message: '导出行数超过上限，请收窄筛选条件' });
  if (rowCount !== null && (input.splitRows ?? 0) > 0 && Math.ceil(rowCount / input.splitRows!) > 200) throw new HTTPException(400, { message: '分卷数量超过200，请增大每卷行数' });
  const asynchronous = !!definition.withSnapshot || execution.mode === 'async' || input.executionMode === 'async' || (rowCount ?? 0) > execution.syncMaxRows || (raw && execution.forceAsyncWhenRaw) || (sensitive && execution.forceAsyncWhenSensitive);
  return { definition, policy, format, raw, query, columns, selectedColumns, sensitive, scope, rowIds, total, rowCount, execution, executionMode: asynchronous ? 'async' as const : 'sync' as const, supportsColumns, supportsPartition, supportsRowScope, canExportRaw };
}
