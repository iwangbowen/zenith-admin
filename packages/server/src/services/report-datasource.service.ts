/**
 * 报表数据源 Service
 * CRUD + 连接配置规整/校验。
 * - api：远程 HTTP（url/method/headers），取数时统一走 http-client（防 SSRF）。
 * - sql：内置只读主库，取数时复用 db-admin 只读执行器。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { reportDatasources, reportDatasets } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { ReportDatasourceRow } from '../db/schema';
import type {
  ReportDatasource, ReportDatasourceConfig, ReportDatasourceType,
  CreateReportDatasourceInput, UpdateReportDatasourceInput,
} from '@zenith/shared';

export function mapDatasource(row: ReportDatasourceRow): ReportDatasource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: (row.config ?? {}) as ReportDatasourceConfig,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 按 type 规整并校验连接配置；非法时抛 HTTPException(400) */
export function normalizeDatasourceConfig(
  type: ReportDatasourceType,
  config: Record<string, unknown> | null | undefined,
): ReportDatasourceConfig {
  const cfg = (config ?? {}) as Record<string, unknown>;
  if (type === 'api') {
    const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      throw new HTTPException(400, { message: 'API 数据源需提供以 http:// 或 https:// 开头的 URL' });
    }
    const method = cfg.method === 'POST' ? 'POST' : 'GET';
    const headers = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
      ? (cfg.headers as Record<string, string>)
      : null;
    return { url, method, headers };
  }
  // sql：MVP 仅支持内置只读主库
  return { connection: 'internal' };
}

export async function ensureDatasourceExists(id: number): Promise<ReportDatasourceRow> {
  const [row] = await db.select().from(reportDatasources).where(eq(reportDatasources.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '数据源不存在' });
  return row;
}

export async function getDatasource(id: number): Promise<ReportDatasource> {
  return mapDatasource(await ensureDatasourceExists(id));
}

export async function listDatasources(query: {
  page?: number; pageSize?: number; keyword?: string; type?: string; status?: string;
}) {
  const { page = 1, pageSize = 20, keyword, type, status } = query;
  const conds = [];
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDatasources.name, kw), ilike(reportDatasources.remark, kw)));
  }
  if (type === 'api' || type === 'sql') conds.push(eq(reportDatasources.type, type));
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDatasources.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDatasources, where),
    db.select().from(reportDatasources).where(where)
      .orderBy(desc(reportDatasources.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapDatasource), total, page, pageSize };
}

export async function createDatasource(input: CreateReportDatasourceInput): Promise<ReportDatasource> {
  const config = normalizeDatasourceConfig(input.type, input.config);
  try {
    const [row] = await db.insert(reportDatasources).values({
      name: input.name,
      type: input.type,
      config,
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapDatasource(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据源名称已存在');
    throw err;
  }
}

export async function updateDatasource(id: number, input: UpdateReportDatasourceInput): Promise<ReportDatasource> {
  const current = await ensureDatasourceExists(id);
  const nextType = (input.type ?? current.type) as ReportDatasourceType;
  // 改了 type 或传了 config 时重新规整配置
  const config = (input.config !== undefined || input.type !== undefined)
    ? normalizeDatasourceConfig(nextType, (input.config ?? current.config) as Record<string, unknown>)
    : undefined;
  try {
    const [row] = await db.update(reportDatasources).set({
      name: input.name,
      type: input.type,
      config,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDatasources.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '数据源不存在' });
    return mapDatasource(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据源名称已存在');
    throw err;
  }
}

export async function deleteDatasource(id: number): Promise<void> {
  await ensureDatasourceExists(id);
  const used = await db.$count(reportDatasets, eq(reportDatasets.datasourceId, id));
  if (used > 0) throw new HTTPException(400, { message: `该数据源被 ${used} 个数据集引用，无法删除` });
  await db.delete(reportDatasources).where(eq(reportDatasources.id, id));
}
