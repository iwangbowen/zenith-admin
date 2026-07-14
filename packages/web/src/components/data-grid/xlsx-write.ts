import JSZip from 'jszip';

type Cell = unknown;

function columnLetter(idx: number): string {
  let n = idx;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function xmlEscape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    // 剔除 XML 1.0 非法控制字符
    // eslint-disable-next-line no-control-regex
    .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function cellXml(ref: string, value: Cell): string {
  if (value === null || value === undefined) return `<c r="${ref}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

/** 生成 sheet XML（inline string，免共享字符串表） */
export function buildSheetXml(headers: string[], rows: Cell[][]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  lines.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
  const headerCells = headers.map((h, c) => cellXml(`${columnLetter(c)}1`, h)).join('');
  lines.push(`<row r="1">${headerCells}</row>`);
  rows.forEach((row, r) => {
    const cells = row.map((v, c) => cellXml(`${columnLetter(c)}${r + 2}`, v)).join('');
    lines.push(`<row r="${r + 2}">${cells}</row>`);
  });
  lines.push('</sheetData></worksheet>');
  return lines.join('');
}

/**
 * 生成最小可用的单 Sheet XLSX（Office Open XML）。
 * 支持数字 / 布尔 / 内联字符串；NULL 输出空单元格。
 */
export async function buildXlsx(sheetName: string, headers: string[], rows: Cell[][]): Promise<Blob> {
  const safeName = xmlEscape(sheetName.slice(0, 31) || 'Sheet1');
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  zip.file('xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '</Relationships>');
  zip.file('xl/worksheets/sheet1.xml', buildSheetXml(headers, rows));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export { downloadBlob } from '@/utils/download';
