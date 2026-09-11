/**
 * Demo 模式的 PDF 替身：浏览器端没有 pdfkit，用最小合法 PDF（内置 Helvetica，仅 ASCII 文本）
 * 让「打印 / 预览 PDF」链路在 MSW 下可点可看；非 ASCII 字符替换为 `?`，交叉引用表按真实偏移生成。
 */
import { HttpResponse } from 'msw';

function pdfEscape(text: string): string {
  return text.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
}

export function buildDemoPdf(lines: string[]): Uint8Array {
  const content = [
    'BT',
    '/F1 18 Tf 56 780 Td',
    `(${pdfEscape(lines[0] ?? 'Zenith Admin Demo')}) Tj`,
    '/F1 11 Tf',
    ...lines.slice(1).map((line) => `0 -22 Td (${pdfEscape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

export function demoPdfResponse(lines: string[], filename: string): HttpResponse<Uint8Array> {
  return new HttpResponse(buildDemoPdf(lines), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
