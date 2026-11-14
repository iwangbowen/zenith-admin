/**
 * 导入模板生成：表头（必填标星）+ 枚举数据验证下拉 + 示例行 + 说明批注。
 */
import type { ImportColumnMeta } from '@zenith/shared/tasks';

export async function buildImportTemplate(title: string, columns: ImportColumnMeta[]): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${title}导入模板`);

  sheet.columns = columns.map((col) => ({
    key: col.key,
    width: Math.max(14, col.header.length * 2 + 4),
  }));

  const headerRow = sheet.getRow(1);
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = col.required ? `${col.header}*` : col.header;
    cell.font = { bold: true, color: col.required ? { argb: 'FFCC0000' } : undefined };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8E8E8' } };
    const noteParts = [
      col.required ? '必填' : '选填',
      col.enumValues?.length ? `可选值：${col.enumValues.join(' / ')}` : null,
      col.note ?? null,
    ].filter(Boolean);
    cell.note = noteParts.join('；');
  });

  // 枚举列：前 1000 行加数据验证下拉
  columns.forEach((col, i) => {
    if (!col.enumValues?.length) return;
    for (let r = 2; r <= 1000; r++) {
      sheet.getRow(r).getCell(i + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${col.enumValues.join(',')}"`],
      };
    }
  });

  const noteSheet = workbook.addWorksheet('填写说明');
  noteSheet.getCell('A1').value = `${title}导入填写说明`;
  noteSheet.getCell('A1').font = { bold: true, size: 14 };
  noteSheet.getCell('A3').value = '字段';
  noteSheet.getCell('B3').value = '示例值';
  noteSheet.getCell('C3').value = '说明';
  noteSheet.getRow(3).font = { bold: true };
  columns.forEach((col, index) => {
    const row = noteSheet.getRow(index + 4);
    row.getCell(1).value = col.header;
    row.getCell(2).value = col.example ?? '';
    row.getCell(3).value = [col.required ? '必填' : '选填', col.sensitive ? '敏感值只在当前上传文件中使用，预览样例会脱敏' : null, col.note ?? null, col.enumValues?.length ? `可选值：${col.enumValues.join(' / ')}` : null].filter(Boolean).join('；');
  });
  noteSheet.getColumn(1).width = 22;
  noteSheet.getColumn(2).width = 28;
  noteSheet.getColumn(3).width = 70;

  return workbook.xlsx.writeBuffer();
}
