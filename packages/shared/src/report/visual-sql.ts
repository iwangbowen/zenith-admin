import type { ReportVisualFilter, ReportVisualJoin, ReportVisualMetric, ReportVisualModel } from './contracts';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdent(name: string): string {
  const n = name.trim();
  if (!IDENT_RE.test(n)) throw new Error(`非法标识符：${name}`);
  return `"${n}"`;
}

function quoteFieldRef(name: string): string {
  const parts = name.split('.').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) throw new Error(`非法标识符：${name}`);
  return parts.map(quoteIdent).join('.');
}

function quoteValue(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

function metricExpr(m: ReportVisualMetric): string {
  const alias = (m.alias?.trim() || `${m.field}_${m.aggregate}`).trim();
  if (!IDENT_RE.test(alias)) throw new Error(`非法别名：${alias}`);
  const inner = m.aggregate === 'count' && !m.field ? 'count(*)' : `${m.aggregate}(${quoteFieldRef(m.field)})`;
  return `${inner} AS "${alias}"`;
}

/** 指标的输出列名（供排序引用） */
export function visualMetricAlias(m: ReportVisualMetric): string {
  return (m.alias?.trim() || `${m.field}_${m.aggregate}`).trim();
}

function filterExpr(f: ReportVisualFilter): string {
  const col = quoteFieldRef(f.field);
  const v = f.value ?? '';
  switch (f.op) {
    case 'eq': return `${col}::text = ${quoteValue(v)}`;
    case 'neq': return `${col}::text <> ${quoteValue(v)}`;
    case 'gt': return `${col} > ${quoteValue(v)}`;
    case 'gte': return `${col} >= ${quoteValue(v)}`;
    case 'lt': return `${col} < ${quoteValue(v)}`;
    case 'lte': return `${col} <= ${quoteValue(v)}`;
    case 'like': return `${col}::text ILIKE ${quoteValue(`%${v}%`)}`;
    default: throw new Error(`不支持的操作符：${String(f.op)}`);
  }
}

function joinExpr(baseTable: string, baseAlias: string | undefined, join: ReportVisualJoin): string {
  const joinType = join.type === 'inner' ? 'INNER JOIN' : 'LEFT JOIN';
  const sourceAlias = (join.sourceAlias?.trim() || baseAlias?.trim() || baseTable.trim());
  const joinAlias = join.alias?.trim() || join.table.trim();
  const table = quoteIdent(join.table);
  const aliasClause = joinAlias !== join.table.trim() ? ` AS ${quoteIdent(joinAlias)}` : '';
  return `${joinType} ${table}${aliasClause} ON ${quoteIdent(sourceAlias)}.${quoteIdent(join.sourceField)} = ${quoteIdent(joinAlias)}.${quoteIdent(join.targetField)}`;
}

/**
 * 由可视化模型生成 SELECT 语句。
 * - 维度进 SELECT + GROUP BY；指标以聚合函数输出；
 * - 无维度无指标 → SELECT *；仅维度无指标 → 维度去重（GROUP BY）。
 */
export function buildVisualSql(model: ReportVisualModel): string {
  const table = quoteIdent(model.table);
  const baseAlias = model.alias?.trim();
  const fromClause = baseAlias && baseAlias !== model.table.trim()
    ? `${table} AS ${quoteIdent(baseAlias)}`
    : table;
  const dims = (model.dimensions ?? []).map((d) => d.trim()).filter(Boolean);
  const metrics = (model.metrics ?? []).filter((m) => m.field || m.aggregate === 'count');
  const selectParts = [
    ...dims.map(quoteFieldRef),
    ...metrics.map(metricExpr),
  ];
  const lines: string[] = [];
  lines.push(`SELECT ${selectParts.length ? selectParts.join(', ') : '*'}`);
  lines.push(`FROM ${fromClause}`);
  for (const join of (model.joins ?? [])) lines.push(joinExpr(model.table, baseAlias, join));
  const filters = (model.filters ?? []).filter((f) => f.field && f.value !== '');
  if (filters.length) lines.push(`WHERE ${filters.map(filterExpr).join(' AND ')}`);
  if (dims.length) lines.push(`GROUP BY ${dims.map(quoteFieldRef).join(', ')}`);
  if (model.orderBy?.field) {
    const dir = model.orderBy.order === 'asc' ? 'ASC' : 'DESC';
    lines.push(`ORDER BY ${quoteFieldRef(model.orderBy.field)} ${dir}`);
  }
  const limit = model.limit ?? null;
  if (limit && limit > 0) lines.push(`LIMIT ${Math.min(Math.floor(limit), 5000)}`);
  return lines.join('\n');
}
