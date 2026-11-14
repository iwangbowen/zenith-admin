import '@hono/zod-openapi';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderPrintContent } from '@zenith/shared/report';
import { renderPrintResultToPdf, renderPrintResultToDocx } from '../src/lib/report-print-export';
const out = resolve('../../output/export-special/documents');
await mkdir(out, { recursive: true });
const cells = Array.from({ length: 45 }, (_, row) => [
  { row: row + 1, col: 0, v: '项目 ' + String(row + 1).padStart(2, '0') },
  { row: row + 1, col: 1, v: '中文说明：正常换行、跨页与页码校验 ' + (row + 1) },
  { row: row + 1, col: 2, v: String(1234.56 + row), numFmt: '#,##0.00' },
]).flat();
const result = renderPrintContent('导出专项版式验收', { sheets: [{ id: 'portrait', name: '财务明细', grid: { rows: 46, cols: 3, colWidths: [90, 300, 100], rowHeights: Array(46).fill(27), cells: [{ row: 0, col: 0, v: '项目', s: { bold: true, border: true } }, { row: 0, col: 1, v: '说明', s: { bold: true, border: true } }, { row: 0, col: 2, v: '金额', s: { bold: true, border: true } }, ...cells] }, pageConfig: { rowsPerPage: 16, repeatHeaderRows: { start: 0, end: 0 }, footer: '第 {page}/{pages} 页' } }, { id: 'landscape', name: '横向核对', grid: { rows: 3, cols: 3, colWidths: [180, 280, 180], rowHeights: [40, 40, 70], cells: [{ row: 0, col: 0, v: '横向合并标题', s: { bold: true, align: 'center', background: '#eeeeee' } }, { row: 1, col: 0, v: '二维码' }, { row: 1, col: 1, v: '${QRCODE(code)}' }, { row: 2, col: 0, v: '末页内容完整 END-OF-REPORT' }], merges: [{ row: 0, col: 0, rowSpan: 1, colSpan: 3 }] }, pageConfig: { orientation: 'landscape', footer: '第 {page}/{pages} 页' } }] }, [{ code: 'export-qa-20261114' }]);
await writeFile(resolve(out, 'report.pdf'), await renderPrintResultToPdf(result));
await writeFile(resolve(out, 'report.docx'), await renderPrintResultToDocx(result));
await writeFile(resolve(out, 'expected.json'), JSON.stringify({ pages: result.pages.length, rows: 45, last: 'END-OF-REPORT' }));
process.stdout.write(JSON.stringify({ pages: result.pages.length, out }) + '\n');
