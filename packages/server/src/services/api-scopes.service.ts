import { eq, and, or, desc, ilike, inArray, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { apiScopes } from '../db/schema';
import type { ApiScopeRow } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import type { CreateApiScopeInput, UpdateApiScopeInput } from '@zenith/shared';

export function mapApiScope(row: ApiScopeRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    scopeGroup: row.scopeGroup,
    status: row.status,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function listApiScopes(opts: {
  page: number;
  pageSize: number;
  keyword?: string;
  scopeGroup?: string;
  status?: 'enabled' | 'disabled';
}) {
  const { page, pageSize, keyword, scopeGroup, status } = opts;
  const conditions: SQL[] = [];
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conditions.push(or(ilike(apiScopes.code, kw), ilike(apiScopes.name, kw)) as SQL);
  }
  if (scopeGroup) conditions.push(eq(apiScopes.scopeGroup, scopeGroup));
  if (status) conditions.push(eq(apiScopes.status, status));
  const where = conditions.length ? and(...conditions) : undefined;

  const [list, total] = await Promise.all([
    db.select().from(apiScopes)
      .where(where)
      .orderBy(desc(apiScopes.createdAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    db.$count(apiScopes, where),
  ]);
  return { list: list.map(mapApiScope), total, page, pageSize };
}

/** 全部启用的 scope（供应用配置下拉，无分页） */
export async function listEnabledApiScopes() {
  const rows = await db.select().from(apiScopes)
    .where(eq(apiScopes.status, 'enabled'))
    .orderBy(apiScopes.scopeGroup, apiScopes.code);
  return rows.map(mapApiScope);
}

export async function getApiScope(id: number) {
  const [row] = await db.select().from(apiScopes).where(eq(apiScopes.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: 'API Scope 不存在' });
  return mapApiScope(row);
}

export async function getApiScopeBeforeAudit(id: number) {
  return getApiScope(id);
}

export async function createApiScope(input: CreateApiScopeInput) {
  try {
    const [row] = await db.insert(apiScopes).values({
      code: input.code.trim(),
      name: input.name.trim(),
      description: input.description,
      scopeGroup: input.scopeGroup ?? 'general',
      status: input.status ?? 'enabled',
    }).returning();
    return mapApiScope(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, 'scope 编码已存在');
    throw err;
  }
}

export async function updateApiScope(id: number, input: UpdateApiScopeInput) {
  await getApiScope(id);
  try {
    const [row] = await db.update(apiScopes).set({
      name: input.name?.trim(),
      description: input.description,
      scopeGroup: input.scopeGroup,
      status: input.status,
    }).where(eq(apiScopes.id, id)).returning();
    return mapApiScope(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, 'scope 编码已存在');
    throw err;
  }
}

export async function deleteApiScope(id: number) {
  const result = await db.delete(apiScopes).where(eq(apiScopes.id, id)).returning();
  if (result.length === 0) throw new HTTPException(404, { message: 'API Scope 不存在' });
}

export async function batchDeleteApiScopes(ids: number[]) {
  if (ids.length === 0) return 0;
  const result = await db.delete(apiScopes).where(inArray(apiScopes.id, ids)).returning();
  return result.length;
}
