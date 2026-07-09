/**
 * 报表数据源 Service
 * CRUD + 连接配置规整/校验。
 * - api：远程 HTTP（url/method/headers），取数时统一走 http-client（防 SSRF）。
 * - sql：内置只读主库，取数时复用只读执行器。
 * - mysql/postgresql：外部数据库，凭据 AES-GCM 加密存储，取数走 report-external-db。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db';
import { reportDatasources, reportDatasets } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { encryptField, decryptField } from '../../lib/encryption';
import { testExternalConnection } from '../../lib/report-external-db';
import { assertSafeOutboundHost, assertSafeOutboundUrl } from '../../lib/outbound-url';
import {
  ensureInternalReportDatabaseAccess,
  reportCreateTenantId,
  reportScopedWhere,
  reportTenantScope,
} from './report-access';
import {
  isSensitiveReportHeader,
  REPORT_SECRET_MASK,
} from './report-secrets';
import { isExternalDbType, REPORT_DATASOURCE_TYPES } from '@zenith/shared';
import type { ReportDatasourceRow } from '../../db/schema';
import type {
  ReportDatasource, ReportDatasourceConfig, ReportDatasourceType, ReportExternalDbConfig, ReportApiDatasourceConfig,
  CreateReportDatasourceInput, UpdateReportDatasourceInput, ReportDatasourceTestInput,
} from '@zenith/shared';

const DEFAULT_PORT: Record<string, number> = { mysql: 3306, postgresql: 5432, sqlserver: 1433 };
/** 读取展示：敏感 header 值脱敏为掩码 */
function maskApiHeaders(headers: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = isSensitiveReportHeader(k) && v ? REPORT_SECRET_MASK : v;
  return out;
}

/** 写入存储：敏感 header 值加密；若提交为掩码则沿用旧密文；非敏感保持明文 */
function encryptApiHeaders(
  headers: Record<string, string> | null | undefined,
  currentHeaders: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!isSensitiveReportHeader(k) || !v) { out[k] = v; continue; }
    if (v === REPORT_SECRET_MASK) {
      const prev = currentHeaders?.[k];
      if (prev) out[k] = prev; // 沿用旧密文
    } else {
      out[k] = encryptField(v) ?? v;
    }
  }
  return out;
}

/** 取数使用：敏感 header 值解密（密文→明文；非密文原样） */
export function resolveApiHeaders(headers: Record<string, string> | null | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = isSensitiveReportHeader(k) && v ? (decryptField(v) ?? v) : v;
  return out;
}

/** DTO 映射：外部库去 password（hasPassword 标记）；API 敏感 header 脱敏 */
export function mapDatasource(row: ReportDatasourceRow): ReportDatasource {
  let config = (row.config ?? {}) as ReportDatasourceConfig;
  if (isExternalDbType(row.type)) {
    const c = config as ReportExternalDbConfig;
    config = { host: c.host, port: c.port, database: c.database, user: c.user, ssl: c.ssl, hasPassword: !!c.password, password: null };
  } else if (row.type === 'api') {
    const c = config as ReportApiDatasourceConfig;
    config = { url: c.url, method: c.method, headers: maskApiHeaders(c.headers) };
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
 * API：敏感 header 加密；提交掩码时沿用旧密文。
 */
export function normalizeDatasourceConfig(
  type: ReportDatasourceType,
  config: Record<string, unknown> | null | undefined,
  currentConfig?: ReportDatasourceConfig | null,
): ReportDatasourceConfig {
  const cfg = (config ?? {}) as Record<string, unknown>;
  if (type === 'api') {
    const url = typeof cfg.url === 'string' ? cfg.url.trim() : '';
    if (!/^https?:\/\//i.test(url)) {
      throw new HTTPException(400, { message: 'API 数据源需提供以 http:// 或 https:// 开头的 URL' });
    }
    const method = cfg.method === 'POST' ? 'POST' : 'GET';
    const rawHeaders = cfg.headers && typeof cfg.headers === 'object' && !Array.isArray(cfg.headers)
      ? (cfg.headers as Record<string, string>)
      : null;
    const currentHeaders = (currentConfig as ReportApiDatasourceConfig | undefined)?.headers ?? null;
    return { url, method, headers: encryptApiHeaders(rawHeaders, currentHeaders) };
  }
  if (isExternalDbType(type)) {
    const host = typeof cfg.host === 'string' ? cfg.host.trim() : '';
    const database = typeof cfg.database === 'string' ? cfg.database.trim() : '';
    const user = typeof cfg.user === 'string' ? cfg.user.trim() : '';
    if (!host || !database || !user) {
      throw new HTTPException(400, { message: '外部数据库需填写 host / database / user' });
    }
    const port = Number(cfg.port) || DEFAULT_PORT[type] || 3306;
    const rawPwd = typeof cfg.password === 'string' && cfg.password ? cfg.password : undefined;
    const currentEncryptedPassword = (currentConfig as ReportExternalDbConfig | undefined)?.password ?? null;
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

async function assertDatasourceTargetSafe(type: ReportDatasourceType, config: ReportDatasourceConfig): Promise<void> {
  if (type === 'api') {
    await assertSafeOutboundUrl((config as ReportApiDatasourceConfig).url);
  } else if (isExternalDbType(type)) {
    await assertSafeOutboundHost((config as ReportExternalDbConfig).host);
  }
}

export async function ensureDatasourceExists(id: number): Promise<ReportDatasourceRow> {
  const [row] = await db.select().from(reportDatasources)
    .where(reportScopedWhere(reportDatasources, eq(reportDatasources.id, id)))
    .limit(1);
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
  const tenantScope = reportTenantScope(reportDatasources);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDatasources.name, kw), ilike(reportDatasources.remark, kw)));
  }
  const reportTypes = REPORT_DATASOURCE_TYPES as readonly string[];
  if (type && reportTypes.includes(type)) {
    conds.push(eq(reportDatasources.type, type as ReportDatasourceType));
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
  if (input.type === 'sql') ensureInternalReportDatabaseAccess();
  const config = normalizeDatasourceConfig(input.type, input.config);
  await assertDatasourceTargetSafe(input.type, config);
  try {
    const [row] = await db.insert(reportDatasources).values({
      tenantId: reportCreateTenantId(),
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
  if (nextType === 'sql') ensureInternalReportDatabaseAccess();
  if (input.type && input.type !== current.type) {
    const used = await db.$count(reportDatasets, eq(reportDatasets.datasourceId, id));
    if (used > 0) throw new HTTPException(400, { message: '数据源已被数据集引用，不能修改数据源类型' });
  }
  const currentConfig = (current.config ?? null) as ReportDatasourceConfig | null;
  // 改了 type 或传了 config 时重新规整配置
  const config = (input.config !== undefined || input.type !== undefined)
    ? normalizeDatasourceConfig(nextType, (input.config ?? current.config) as Record<string, unknown>, currentConfig)
    : undefined;
  await assertDatasourceTargetSafe(nextType, config ?? currentConfig ?? {});
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
  let type = input.type;
  let cfg: ReportExternalDbConfig;
  if (input.id) {
    const row = await ensureDatasourceExists(input.id);
    type ??= row.type;
    if (!type || !isExternalDbType(type)) {
      return { ok: false, message: '仅外部数据库（MySQL / PostgreSQL / SQL Server）支持连接测试' };
    }
    const stored = row.config as ReportExternalDbConfig;
    const draft = { ...stored, ...(input.config ?? {}) } as Record<string, unknown>;
    const newPwd = input.config && typeof input.config.password === 'string' ? input.config.password : '';
    if (!newPwd) delete draft.password;
    cfg = normalizeDatasourceConfig(type, draft, stored) as ReportExternalDbConfig;
  } else {
    if (!type || !isExternalDbType(type)) {
      return { ok: false, message: '仅外部数据库（MySQL / PostgreSQL / SQL Server）支持连接测试' };
    }
    const normalized = normalizeDatasourceConfig(type, input.config ?? {});
    cfg = normalized as ReportExternalDbConfig;
  }
  await assertDatasourceTargetSafe(type, cfg);
  return testExternalConnection(type, cfg);
}
