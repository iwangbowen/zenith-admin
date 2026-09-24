/**
 * 统一导入任务 handler（taskType 'data-import'）。
 *
 * 流程：文件中心取件 → 表头校验 → contextSchema/prepare → 逐行 parseRow[/insertRow] →
 * 行级 reportItems + 每 10 行进度/checkpoint（断点续跑）→ finalize →
 * 存在失败行时生成「错误行文件」（原数据 + 错误原因列）存入文件中心供修正回导。
 *
 * dryRun 预检模式：仅逐行校验不落库，输出同款行级报告与错误文件。
 */
import { registerTaskHandler } from '../task-center';
import { readFileContent, saveGeneratedManagedFile } from '../../services/files/files.service';
import { currentUser } from '../context';
import { getImportDefinition } from './registry';
import { parseImportWorkbook, type ParsedImportRow } from './parser';
import { DEFAULT_MAX_ROWS, IMPORT_TASK_TYPE, IMPORT_PREVIEW_TASK_TYPE } from './types';
import type { ImportColumnMeta } from '@zenith/shared/tasks';

interface FailedRow {
  rowNum: number;
  cells: Record<string, string>;
  error: string;
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
        const { entity, fileId, context, filename } = ctx.payload as {
          entity?: string; fileId?: string; dryRun?: boolean;
          context?: Record<string, unknown>; filename?: string | null;
        };
        const dryRun = preview;
        if (!entity || !fileId) throw new Error('缺少 entity / fileId 参数');
        const def = getImportDefinition(entity);
        const parsedContext = def.contextSchema ? def.contextSchema.parse(context ?? {}) as Record<string, unknown> : (context ?? {});

        const stored = await readFileContent(fileId);
        const buffer = await new Response(stored.stream).arrayBuffer();
        const rows: ParsedImportRow[] = await parseImportWorkbook(buffer, def.columns, def.maxRows ?? DEFAULT_MAX_ROWS, filename);
        if (rows.length === 0) throw new Error('文件中没有可导入的数据行');

        const prepared = await def.prepare(parsedContext);
        const firstKey = def.columns[0]?.key ?? '';
        const modeNote = dryRun ? '预检' : '导入';

        let processed = Number(ctx.checkpoint?.processed ?? 0);
        let succeeded = Number(ctx.checkpoint?.succeeded ?? 0);
        let failed = Number(ctx.checkpoint?.failed ?? 0);
        const failedRows: FailedRow[] = [];

        for (let i = processed; i < rows.length; i++) {
          const { rowNum, cells } = rows[i];
          const fallbackLabel = cells[firstKey] || `第 ${rowNum} 行`;
          try {
            const row = await def.parseRow(cells, prepared, rowNum);
            if (!dryRun) await def.insertRow(row, prepared);
            succeeded += 1;
            await ctx.reportItems([{
              key: `row-${rowNum}`,
              label: (def.rowLabel?.(row) ?? fallbackLabel).slice(0, 100),
              status: 'success',
              message: dryRun ? '校验通过' : null,
            }]);
          } catch (err) {
            failed += 1;
            const message = (err instanceof Error ? err.message : `${modeNote}失败`).slice(0, 200);
            failedRows.push({ rowNum, cells, error: message });
            await ctx.reportItems([{
              key: `row-${rowNum}`,
              label: fallbackLabel.slice(0, 100),
              status: 'failed',
              message,
            }]);
          }
          processed = i + 1;
          if (processed % 10 === 0 || processed === rows.length) {
            const { cancelRequested } = await ctx.progress({
              processed,
              failed,
              total: rows.length,
              note: `${modeNote}：成功 ${succeeded} / 失败 ${failed}（共 ${rows.length} 行）`,
              checkpoint: { processed, succeeded, failed },
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
          });
          errorFileId = saved.id;
        }

        return { total: rows.length, succeeded, failed, dryRun: dryRun ?? false, errorFileId, errorFileName };
      },
    });
  }
}
