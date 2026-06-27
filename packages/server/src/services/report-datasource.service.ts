/**
 * 报表数据源 Service
 * CRUD + 连接配置规整/校验。
 * - api：远程 HTTP（url/method/headers），取数时统一走 http-client（防 SSRF）。
 * - sql：内置只读主库，取数时复用只读执行器。
 * - mysql/postgresql：外部数据库，凭据 AES-GCM 加密存储，取数走 report-external-db。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { reportDatasources, reportDatasets } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { encryptField } from '../lib/encryption';
import { testExternalConnection } from '../lib/report-external-db';
import type { ReportDatasourceRow } from '../db/schema';
import type {
  ReportDatasource, ReportDatasourceConfig, ReportDatasourceType, ReportExternalDbConfig,
  CreateReportDatasourceInput, UpdateReportDatasourceInput, ReportDatasourceTestInput,
} from '@zenith/shared';

const EXTERNAL_TYPES: ReportDatasourceType[] = ['mysql', 'postgresql', 'sqlserver'];
const DEFAULT_PORT: Record<string, number> = { mysql: 3306, postgresql: 5432, sqlserver: 1433 };

/** DTO 映射：外部库 config 脱敏（去 password，给 hasPassword 标记） */
export function mapDatasource(row: ReportDatasourceRow): ReportDatasource {
  let config = (row.config ?? {}) as ReportDatasourceConfig;
  if (EXTERNAL_TYPES.includes(row.type)) {
    const c = config as ReportExternalDbConfig;
    config = { host: c.host, port: c.port, database: c.database, user: c.user, ssl: c.ssl, hasPassword: !!c.password, password: null };
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/**
 * 按 type 规整并校验连接配置；非法时抛 HTTPException(400)。
 * 外部库：明文 password 加密；未提供时保留 currentEncrypted。
 */
export function normalizeDatasourceConfig(
  type: ReportDatasourceType,
  config: Record<string, unknown> | null | undefined,
  currentEncryptedPassword?: string | null,
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
  if (type === 'mysql' || type === 'postgresql' || type === 'sqlserver') {
    const host = typeof cfg.host === 'string' ? cfg.host.trim() : '';
    const database = typeof cfg.database === 'string' ? cfg.database.trim() : '';
    const user = typeof cfg.user === 'string' ? cfg.user.trim() : '';
    if (!host || !database || !user) {
      throw new HTTPException(400, { message: '外部数据库需填写 host / database / user' });
    }
    const port = Number(cfg.port) || DEFAULT_PORT[type] || 3306;
    const rawPwd = typeof cfg.password === 'string' && cfg.password ? cfg.password : undefined;
    // 新明文密码加密；未提供则沿用旧密文
    const password = rawPwd ? encryptField(rawPwd) : (currentEncryptedPassword ?? null);
    return { host, port, database, user, password, ssl: !!cfg.ssl };
  }
  if (type === 'static') {
    // 静态数据源仅作容器，数据放在数据集 content.data
    return {};
  }
  // sql：内置只读主库
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
  if (type === 'api' || type === 'sql' || type === 'mysql' || type === 'postgresql' || type === 'sqlserver' || type === 'static') {
    conds.push(eq(reportDatasources.type, type));
  }
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
  const currentPwd = (current.config as ReportExternalDbConfig | null)?.password ?? null;
  // 改了 type 或传了 config 时重新规整配置
  const config = (input.config !== undefined || input.type !== undefined)
    ? normalizeDatasourceConfig(nextType, (input.config ?? current.config) as Record<string, unknown>, currentPwd)
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

/**
 * 测试外部数据库连接。
 * - 已存在数据源（id）：用库内密文凭据测试，前端无需重发密码。
 * - 新建表单试连：用入参 config（明文 password 临时加密后测试）。
 */
export async function testDatasource(input: ReportDatasourceTestInput): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  if (input.type !== 'mysql' && input.type !== 'postgresql' && input.type !== 'sqlserver') {
    return { ok: false, message: '仅外部数据库（MySQL / PostgreSQL / SQL Server）支持连接测试' };
  }
  let cfg: ReportExternalDbConfig;
  if (input.id) {
    const row = await ensureDatasourceExists(input.id);
    cfg = row.config as ReportExternalDbConfig;
    // 若表单又带了新密码，覆盖测试
    const newPwd = input.config && typeof input.config.password === 'string' ? input.config.password : '';
    if (newPwd) cfg = { ...cfg, password: encryptField(newPwd) };
  } else {
    const normalized = normalizeDatasourceConfig(input.type, input.config ?? {});
    cfg = normalized as ReportExternalDbConfig;
  }
  return testExternalConnection(input.type, cfg);
}
