/**
 * 统一导入任务 handler（taskType 'data-import'）。
 *
 * 流程：文件中心取件 → 表头校验 → contextSchema/prepare → 逐行 parseRow[/insertRow] →
 * 行级 reportItems + 每 10 行进度/checkpoint（断点续跑）→ finalize →
 * 存在失败行时生成「错误行文件」（原数据 + 错误原因列）存入文件中心供修正回导。
 *
 * dryRun 预检模式：仅逐行校验不落库，输出同款行级报告与错误文件。
 */
import { registerTaskHandler, TaskNonRetryableError } from '../task-center';
import { HTTPException } from 'hono/http-exception';
import { getPgErrorCode, isPgUniqueViolation } from '../db-errors';
import { readGeneratedManagedFile, saveGeneratedManagedFile } from '../../services/files/files.service';
import { releaseManagedFiles, retainManagedFiles } from '../../services/files/file-gc.service';
import { withDbExecutor } from '../../db';
import { and, eq } from 'drizzle-orm';
import { asyncTasks, type AsyncTaskRow } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import { currentUser } from '../context';
import { getImportDefinition } from './registry';
import { parseImportWorkbook, type ParsedImportRow } from './parser';
import { DEFAULT_MAX_ROWS, IMPORT_TASK_TYPE, IMPORT_PREVIEW_TASK_TYPE } from './types';
import { isAsyncTaskTerminal, type ImportColumnMeta } from '@zenith/shared/tasks';
import { withImportAuthorization } from './authorization';

interface FailedRow {
  rowNum: number;
  cells: Record<string, string>;
  error: string;
}

function retainedErrorFileIds(task: Pick<AsyncTaskRow, 'checkpoint' | 'result'>): string[] {
  const checkpointIds = Array.isArray(task.checkpoint?.managedErrorFileIds)
    ? task.checkpoint.managedErrorFileIds.filter((id): id is string => typeof id === 'string')
    : [];
  const resultId = typeof task.result?.errorFileId === 'string' ? task.result.errorFileId : null;
  return [...new Set([...checkpointIds, ...(resultId ? [resultId] : [])])];
}

async function releaseErrorFiles(tx: DbTransaction, task: Pick<AsyncTaskRow, 'checkpoint' | 'result'>): Promise<void> {
  await releaseManagedFiles(tx, retainedErrorFileIds(task));
}

function checkpointFailedRows(value: unknown): FailedRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Partial<FailedRow>;
    if (typeof row.rowNum !== 'number' || typeof row.error !== 'string' || !row.cells || typeof row.cells !== 'object') return [];
    return [{ rowNum: row.rowNum, cells: row.cells as Record<string, string>, error: row.error }];
  });
}

function isRowWriteRejection(error: unknown): boolean {
  if (error instanceof HTTPException) return error.status === 400 || error.status === 409;
  return getPgErrorCode(error)?.startsWith('23') ?? false;
}

/** 失败行回导文件：原表头 + 原数据 + 「错误原因」列（红字），修正后可直接重新上传 */
async function buildErrorWorkbook(columns: ImportColumnMeta[], failed: FailedRow[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('错误行');
  const headerRow = sheet.getRow(1);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.required ? `${col.header}*` : col.header;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    sheet.getColumn(i + 1).width = Math.max(14, col.header.length * 2 + 4);
  });
  const errorCol = columns.length + 1;
  const errorHeader = headerRow.getCell(errorCol);
  errorHeader.value = '错误原因';
  errorHeader.font = { bold: true, color: { argb: 'FFCC0000' } };
  errorHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } };
  sheet.getColumn(errorCol).width = 40;

  failed.forEach((row, i) => {
    const r = sheet.getRow(i + 2);
    columns.forEach((col, j) => {
      r.getCell(j + 1).value = row.cells[col.key] ?? '';
    });
    const errCell = r.getCell(errorCol);
    errCell.value = row.error;
    errCell.font = { color: { argb: 'FFCC0000' } };
  });
  return workbook.xlsx.writeBuffer();
}

export function registerImportTaskHandler(): void {
  for (const preview of [false, true]) {
    registerTaskHandler({
      taskType: preview ? IMPORT_PREVIEW_TASK_TYPE : IMPORT_TASK_TYPE,
      title: preview ? '导入预检' : '数据导入',
      module: '导入中心',
      allowConcurrent: preview,
      maxAttempts: 1,
      async run(ctx) {
        return withImportAuthorization(ctx, async () => {
        const { entity, fileId, context, filename, fieldMapping, duplicateMode } = ctx.payload as {
          entity?: string; fileId?: string; dryRun?: boolean; fieldMapping?: Record<string, string | null>; duplicateMode?: 'error' | 'skip';
          context?: Record<string, unknown>; filename?: string | null;
        };
        const dryRun = preview;
        if (!entity || !fileId) throw new Error('缺少 entity / fileId 参数');
        let def: ReturnType<typeof getImportDefinition>;
        let parsedContext: Record<string, unknown>;
        let rows: ParsedImportRow[];
        try {
          def = getImportDefinition(entity);
          parsedContext = def.contextSchema ? def.contextSchema.parse(context ?? {}) as Record<string, unknown> : (context ?? {});
          const stored = await readGeneratedManagedFile(fileId, ctx.tenantId);
          const buffer = await new Response(stored.stream).arrayBuffer();
          rows = await parseImportWorkbook(buffer, def.columns, def.maxRows ?? DEFAULT_MAX_ROWS, filename, fieldMapping);
          if (rows.length === 0) throw new HTTPException(400, { message: '文件中没有可导入的数据行' });
        } catch (error) {
          if (error instanceof HTTPException && error.status < 500 || error instanceof Error && 'issues' in error) {
            throw new TaskNonRetryableError(error instanceof Error ? error.message : '导入文件规格无效', { cause: error });
          }
          throw error;
        }

        const prepared = await def.prepare(parsedContext);
        const firstKey = def.columns[0]?.key ?? '';
        const modeNote = dryRun ? '预检' : '导入';

        let processed = Number(ctx.checkpoint?.processed ?? 0);
        let succeeded = Number(ctx.checkpoint?.succeeded ?? 0);
        let failed = Number(ctx.checkpoint?.failed ?? 0);
        let skippedCount = Number(ctx.checkpoint?.skipped ?? 0);
        const failedRows: FailedRow[] = checkpointFailedRows(ctx.checkpoint?.failedRows);
        const seenKeys = new Set<string>(Array.isArray(ctx.checkpoint?.seenKeys) ? ctx.checkpoint.seenKeys.filter((key): key is string => typeof key === 'string') : []);

        for (let i = processed; i < rows.length; i++) {
          const { rowNum, cells } = rows[i];
          const fallbackLabel = cells[firstKey] || `第 ${rowNum} 行`;
          let writing = false;
          let skipped = false;
          try {
            const row = await def.parseRow(cells, prepared, rowNum);
            const legacyDuplicateKey = def.duplicateKey?.(row);
            const duplicateKeys = def.duplicateKeys?.(row) ?? (legacyDuplicateKey ? [legacyDuplicateKey] : []);
            if (duplicateKeys.length > 0) {
              if (duplicateKeys.some(key => seenKeys.has(key))) {
                if (duplicateMode === 'skip') skipped = true;
                else throw new HTTPException(400, { message: '与文件内前序记录重复' });
              }
            }
            if (!skipped) {
              writing = true;
              const nextProcessed = i + 1;
              const nextSucceeded = succeeded + 1;
              const nextKeys = new Set([...seenKeys, ...duplicateKeys]);
              await ctx.transaction(tx => withDbExecutor(tx, async () => {
                if (!dryRun) await def.insertRow(row, prepared);
                await ctx.reportItems([{
                  key: `row-${rowNum}`,
                  label: (def.rowLabel?.(row) ?? fallbackLabel).slice(0, 100),
                  status: 'success',
                  message: dryRun ? '校验通过' : null,
                }]);
                await tx.update(asyncTasks).set({
                  processedCount: nextProcessed,
                  failedCount: failed,
                  totalCount: rows.length,
                  checkpoint: { processed: nextProcessed, succeeded: nextSucceeded, failed, skipped: skippedCount, seenKeys: [...nextKeys], failedRows, managedErrorFileIds: Array.isArray(ctx.checkpoint?.managedErrorFileIds) ? ctx.checkpoint.managedErrorFileIds : [] },
                  heartbeatAt: new Date(),
                }).where(and(eq(asyncTasks.id, ctx.taskId), eq(asyncTasks.dispatchToken, ctx.dispatchToken), eq(asyncTasks.status, 'running')));
              }));
              succeeded = nextSucceeded;
              processed = nextProcessed;
              duplicateKeys.forEach(key => seenKeys.add(key));
            } else {
              await ctx.reportItems([{ key: `row-${rowNum}`, label: fallbackLabel.slice(0, 100), status: 'skipped', message: '与文件内前序记录重复，已跳过' }]);
              skippedCount += 1;
            }
          } catch (err) {
            const code = getPgErrorCode(err);
            if (err instanceof HTTPException && err.status >= 500 || code && !code.startsWith('23')) throw err;
            if (writing && !isRowWriteRejection(err)) throw err;
            const message = (err instanceof Error ? err.message : `${modeNote}失败`).slice(0, 200);
            if (duplicateMode === 'skip' && (isPgUniqueViolation(err) || /重复|已存在|已占用|已被占用/u.test(message))) {
              await ctx.reportItems([{ key: `row-${rowNum}`, label: fallbackLabel.slice(0, 100), status: 'skipped', message: `重复记录，已跳过：${message}` }]);
              skippedCount += 1;
            } else {
              failed += 1;
              failedRows.push({ rowNum, cells, error: message });
              await ctx.reportItems([{
                key: `row-${rowNum}`,
                label: fallbackLabel.slice(0, 100),
                status: 'failed',
                message,
              }]);
            }
          }
          processed = i + 1;
          if (processed % 10 === 0 || processed === rows.length) {
            const { cancelRequested } = await ctx.progress({
              processed,
              failed,
              total: rows.length,
              note: `${modeNote}：成功 ${succeeded} / 失败 ${failed} / 跳过 ${skippedCount}（共 ${rows.length} 行）`,
              checkpoint: { processed, succeeded, failed, skipped: skippedCount, seenKeys: [...seenKeys], failedRows, managedErrorFileIds: Array.isArray(ctx.checkpoint?.managedErrorFileIds) ? ctx.checkpoint.managedErrorFileIds : [] },
            });
            if (cancelRequested) return { processed, succeeded, failed, cancelled: true };
          }
        }

        if (!dryRun) await def.finalize?.(prepared, { succeeded, failed });

        // 失败行回导文件：修正「错误原因」列指出的问题后即可重新上传
        let errorFileId: string | null = null;
        let errorFileName: string | null = null;
        if (failedRows.length > 0) {
          const user = currentUser();
          const errorBuffer = await buildErrorWorkbook(def.columns, failedRows);
          errorFileName = `${def.title}${modeNote}错误行-${Date.now()}.xlsx`;
          const saved = await saveGeneratedManagedFile({
            buffer: errorBuffer,
            filename: errorFileName,
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            tenantId: user.tenantId ?? null,
            createdBy: user.userId,
            visibility: 'restricted',
          });
          errorFileId = saved.id;
        }

        return { total: rows.length, succeeded, failed, skipped: skippedCount, dryRun: dryRun ?? false, errorFileId, errorFileName };
        });
      },
      settleInTransaction: async (tx, task) => {
        if (!isAsyncTaskTerminal(task.status)) return;
        const previous = Array.isArray(task.checkpoint?.managedErrorFileIds)
          ? task.checkpoint.managedErrorFileIds.filter((id): id is string => typeof id === 'string')
          : [];
        const current = typeof task.result?.errorFileId === 'string' ? task.result.errorFileId : null;
        const nextIds = current ? [current] : task.status === 'success' ? [] : previous;
        const released = previous.filter(id => !nextIds.includes(id));
        if (released.length) await releaseManagedFiles(tx, released);
        if (current && !previous.includes(current)) await retainManagedFiles(tx, [current]);
        await tx.update(asyncTasks)
          .set({ checkpoint: { ...(task.checkpoint ?? {}), managedErrorFileIds: nextIds } })
          .where(eq(asyncTasks.id, task.id));
      },
      cleanupInTransaction: async (tx, task) => {
        const fileId = typeof task.payload?.fileId === 'string' ? task.payload.fileId : null;
        if (fileId) await releaseManagedFiles(tx, [fileId]);
        await releaseErrorFiles(tx, task);
      },
      resetInTransaction: async (tx, task) => { await releaseErrorFiles(tx, task); },
    });
  }
}
