/**
 * 表单远程数据源 Service
 * CRUD + 代理拉取选项（仅登记 URL 可被调用，统一走 http-client，防 SSRF）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../../db';
import { workflowDataSources } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { httpRequest } from '../../lib/http-client';
import { decryptSecret, encryptSecret } from '../../lib/secret-crypto';
import type { WorkflowDataSourceRow } from '../../db/schema';
import type {
  WorkflowDataSource, WorkflowDataSourceOption,
  CreateWorkflowDataSourceInput, UpdateWorkflowDataSourceInput,
} from '@zenith/shared';

const OPTIONS_CACHE_TTL = 30_000;
const optionsCache = new Map<string, { data: WorkflowDataSourceOption[]; expire: number }>();
const rawItemsCache = new Map<string, { data: Array<Record<string, unknown>>; expire: number }>();

/** 脱敏占位：GET 返回请求头的值统一替换为该占位；更新时值为占位则保留旧值 */
const HEADER_MASK = '******';

/** 解密请求头（AES-256-GCM 存储的 JSON 键值对；解密失败按无请求头处理） */
function decryptHeaders(encrypted: string | null | undefined): Record<string, string> | null {
  if (!encrypted) return null;
  try {
    const v = JSON.parse(decryptSecret(encrypted)) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>;
  } catch { /* 解密/解析失败按无请求头处理 */ }
  return null;
}

function encryptHeaders(headers: Record<string, string> | null | undefined): string | null {
  if (!headers || Object.keys(headers).length === 0) return null;
  return encryptSecret(JSON.stringify(headers));
}

/** 请求头脱敏：键保留、值统一打码（编辑回填时值为打码占位则沿用旧值） */
function maskHeaders(headers: Record<string, string> | null): Record<string, string> | null {
  if (!headers) return null;
  return Object.fromEntries(Object.keys(headers).map((k) => [k, HEADER_MASK]));
}

/** 合并更新：传入值为脱敏占位的键沿用旧值，其余按传入覆盖 */
function mergeHeadersForUpdate(
  incoming: Record<string, string> | null | undefined,
  existingEncrypted: string | null,
): string | null {
  if (incoming === undefined) return existingEncrypted;
  if (incoming === null) return null;
  const existing = decryptHeaders(existingEncrypted) ?? {};
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    merged[k] = v === HEADER_MASK ? (existing[k] ?? '') : v;
  }
  return encryptHeaders(merged);
}

export function mapDataSource(row: WorkflowDataSourceRow): WorkflowDataSource {
  return {
    id: row.id,
    name: row.name,
    method: (row.method === 'POST' ? 'POST' : 'GET'),
    url: row.url,
    headers: maskHeaders(decryptHeaders(row.headersEncrypted)),
    itemsPath: row.itemsPath ?? null,
    valueField: row.valueField,
    labelField: row.labelField,
    keywordParam: row.keywordParam ?? null,
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureDataSourceExists(id: number): Promise<WorkflowDataSourceRow> {
  const [row] = await db.select().from(workflowDataSources).where(eq(workflowDataSources.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '数据源不存在' });
  return row;
}

export async function getDataSource(id: number): Promise<WorkflowDataSource> {
  return mapDataSource(await ensureDataSourceExists(id));
}

export async function listDataSources(query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
  const { page = 1, pageSize = 20, keyword, status } = query;
  const conds = [];
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(workflowDataSources.name, kw), ilike(workflowDataSources.url, kw)));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(workflowDataSources.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowDataSources, where),
    db.select().from(workflowDataSources).where(where).orderBy(desc(workflowDataSources.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapDataSource), total, page, pageSize };
}

export async function createDataSource(input: CreateWorkflowDataSourceInput): Promise<WorkflowDataSource> {
  try {
    const [row] = await db.insert(workflowDataSources).values({
      name: input.name,
      method: input.method ?? 'GET',
      url: input.url,
      headersEncrypted: encryptHeaders(input.headers),
      itemsPath: input.itemsPath,
      valueField: input.valueField,
      labelField: input.labelField,
      keywordParam: input.keywordParam,
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapDataSource(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据源名称已存在');
    throw err;
  }
}

export async function updateDataSource(id: number, input: UpdateWorkflowDataSourceInput): Promise<WorkflowDataSource> {
  const existing = await ensureDataSourceExists(id);
  try {
    const [row] = await db.update(workflowDataSources).set({
      name: input.name,
      method: input.method,
      url: input.url,
      headersEncrypted: mergeHeadersForUpdate(input.headers, existing.headersEncrypted),
      itemsPath: input.itemsPath,
      valueField: input.valueField,
      labelField: input.labelField,
      keywordParam: input.keywordParam,
      status: input.status,
      remark: input.remark,
    }).where(eq(workflowDataSources.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '数据源不存在' });
    optionsCache.clear();
    rawItemsCache.clear();
    return mapDataSource(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '数据源名称已存在');
    throw err;
  }
}

export async function deleteDataSource(id: number): Promise<void> {
  await db.delete(workflowDataSources).where(eq(workflowDataSources.id, id));
  optionsCache.clear();
  rawItemsCache.clear();
}

function navigatePath(json: unknown, path?: string | null): unknown {
  if (!path) return json;
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key.trim()] : undefined),
    json,
  );
}

/** 代理拉取数据源原始记录列表（带 30s 缓存），选项与记录回填共用 */
async function fetchDataSourceRawItems(id: number, keyword?: string): Promise<Array<Record<string, unknown>>> {
  const cacheKey = `raw:${id}:${keyword ?? ''}`;
  const cached = rawItemsCache.get(cacheKey);
  if (cached && cached.expire > Date.now()) return cached.data;

  const src = await ensureDataSourceExists(id);
  if (src.status !== 'enabled') throw new HTTPException(400, { message: '数据源已停用' });

  const method = src.method === 'POST' ? 'POST' : 'GET';
  let url = src.url;
  let body: Record<string, unknown> | undefined;
  if (keyword && src.keywordParam) {
    if (method === 'GET') {
      const u = new URL(src.url);
      u.searchParams.set(src.keywordParam, keyword);
      url = u.toString();
    } else {
      body = { [src.keywordParam]: keyword };
    }
  }

  let json: unknown;
  try {
    const res = await httpRequest(url, { method, headers: decryptHeaders(src.headersEncrypted) ?? undefined, body, timeout: 10_000 });
    if (!res.ok) throw new HTTPException(502, { message: `数据源返回状态 ${res.status}` });
    json = await res.json();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    throw new HTTPException(502, { message: '数据源请求失败，请检查 URL 与网络' });
  }

  const arr = navigatePath(json, src.itemsPath);
  if (!Array.isArray(arr)) throw new HTTPException(502, { message: '数据源返回结构不是数组，请检查「数组路径」配置' });
  const items = arr.map((item) => (item ?? {}) as Record<string, unknown>);
  rawItemsCache.set(cacheKey, { data: items, expire: Date.now() + OPTIONS_CACHE_TTL });
  return items;
}

/** 代理拉取数据源选项（带 30s 缓存）。仅启用的登记数据源可被调用。 */
export async function fetchDataSourceOptions(id: number, keyword?: string): Promise<WorkflowDataSourceOption[]> {
  const cacheKey = `${id}:${keyword ?? ''}`;
  const cached = optionsCache.get(cacheKey);
  if (cached && cached.expire > Date.now()) return cached.data;

  const src = await ensureDataSourceExists(id);
  const items = await fetchDataSourceRawItems(id, keyword);
  const options = items
    .map((rec) => {
      const value = rec[src.valueField];
      const labelRaw = rec[src.labelField] ?? value;
      return { value: value == null ? '' : String(value), label: labelRaw == null ? '' : String(labelRaw) };
    })
    .filter((o) => o.value !== '');

  optionsCache.set(cacheKey, { data: options, expire: Date.now() + OPTIONS_CACHE_TTL });
  return options;
}

/** 按选项值取数据源完整记录（联动赋值回填其它字段用）；未命中返回 null */
export async function fetchDataSourceRecord(id: number, value: string): Promise<Record<string, unknown> | null> {
  const src = await ensureDataSourceExists(id);
  const items = await fetchDataSourceRawItems(id);
  return items.find((rec) => String(rec[src.valueField] ?? '') === value) ?? null;
}
