/**
 * 可视化建模 → SQL 生成器（纯函数，前后端共用）。
 * 面向内置只读主库（PostgreSQL）：标识符白名单校验 + 双引号包裹，值以字符串字面量转义。
 * 生成的 SQL 仍走只读执行通道（READ ONLY 事务 / 超时 / 行上限），本函数不是安全边界，
 * 但保证生成结果语法可控、无分号、可被数据集编辑器直接采用与手工微调。
 */
import type { ReportVisualModel, ReportVisualMetric, ReportVisualFilter } from './types';

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function quoteIdent(name: string): string {
  const n = name.trim();
  if (!IDENT_RE.test(n)) throw new Error(`非法标识符：${name}`);
  return `"${n}"`;
}

function quoteValue(raw: string): string {
  return `'${raw.replace(/'/g, "''")}'`;
}

function metricExpr(m: ReportVisualMetric): string {
  const alias = (m.alias?.trim() || `${m.field}_${m.aggregate}`).trim();
  if (!IDENT_RE.test(alias)) throw new Error(`非法别名：${alias}`);
  const inner = m.aggregate === 'count' && !m.field ? 'count(*)' : `${m.aggregate}(${quoteIdent(m.field)})`;
  return `${inner} AS "${alias}"`;
}

/** 指标的输出列名（供排序引用） */
export function visualMetricAlias(m: ReportVisualMetric): string {
  return (m.alias?.trim() || `${m.field}_${m.aggregate}`).trim();
}

function filterExpr(f: ReportVisualFilter): string {
  const col = quoteIdent(f.field);
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

/**
 * 由可视化模型生成 SELECT 语句。
 * - 维度进 SELECT + GROUP BY；指标以聚合函数输出；
 * - 无维度无指标 → SELECT *；仅维度无指标 → 维度去重（GROUP BY）。
 */
export function buildVisualSql(model: ReportVisualModel): string {
  const table = quoteIdent(model.table);
  const dims = (model.dimensions ?? []).map((d) => d.trim()).filter(Boolean);
  const metrics = (model.metrics ?? []).filter((m) => m.field || m.aggregate === 'count');
  const selectParts = [
    ...dims.map(quoteIdent),
    ...metrics.map(metricExpr),
  ];
  const lines: string[] = [];
  lines.push(`SELECT ${selectParts.length ? selectParts.join(', ') : '*'}`);
  lines.push(`FROM ${table}`);
  const filters = (model.filters ?? []).filter((f) => f.field && f.value !== '');
  if (filters.length) lines.push(`WHERE ${filters.map(filterExpr).join(' AND ')}`);
  if (dims.length) lines.push(`GROUP BY ${dims.map(quoteIdent).join(', ')}`);
  if (model.orderBy?.field) {
    const dir = model.orderBy.order === 'asc' ? 'ASC' : 'DESC';
    lines.push(`ORDER BY ${quoteIdent(model.orderBy.field)} ${dir}`);
  }
  const limit = model.limit ?? null;
  if (limit && limit > 0) lines.push(`LIMIT ${Math.min(Math.floor(limit), 5000)}`);
  return lines.join('\n');
}
