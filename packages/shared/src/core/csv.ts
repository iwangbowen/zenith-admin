/** Spreadsheet-safe CSV: textual formula prefixes stay literal; numeric values stay numeric. */
export function csvCell(value: unknown): string {
  if (value == null) return '';
  const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const text = typeof value === 'string' && /^[\s]*[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return /[",\n\r\t]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
