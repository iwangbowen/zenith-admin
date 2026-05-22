export function quoteSqlIdent(s: string): string {
  return '"' + s.replaceAll('"', '""') + '"';
}

function escapeSingleQuote(s: string): string {
  return s.replaceAll("'", "''");
}

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return "'" + escapeSingleQuote(v.toISOString()) + "'";
  if (typeof v === 'object') {
    return "'" + escapeSingleQuote(JSON.stringify(v)) + "'::jsonb";
  }
  if (typeof v === 'string') return "'" + escapeSingleQuote(v) + "'";
  return "'" + escapeSingleQuote(JSON.stringify(v)) + "'";
}

export function buildUpdateSql(
  schema: string,
  table: string,
  pk: Record<string, unknown>,
  changes: Record<string, unknown>,
): string {
  const setExpr = Object.entries(changes)
    .map(([k, v]) => quoteSqlIdent(k) + ' = ' + sqlLiteral(v))
    .join(', ');
  const whereExpr = Object.entries(pk)
    .map(([k, v]) => quoteSqlIdent(k) + ' = ' + sqlLiteral(v))
    .join(' AND ');
  return (
    'UPDATE ' + quoteSqlIdent(schema) + '.' + quoteSqlIdent(table) +
    ' SET ' + setExpr + ' WHERE ' + whereExpr + ';'
  );
}

export function buildInsertSql(
  schema: string,
  table: string,
  row: Record<string, unknown>,
): string {
  const entries = Object.entries(row).filter(([k]) => !k.startsWith('__'));
  const cols = entries.map(([k]) => quoteSqlIdent(k)).join(', ');
  const vals = entries.map(([, v]) => sqlLiteral(v)).join(', ');
  return (
    'INSERT INTO ' + quoteSqlIdent(schema) + '.' + quoteSqlIdent(table) +
    ' (' + cols + ') VALUES (' + vals + ');'
  );
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
