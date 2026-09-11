import { eq, desc, inArray, sql } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { apiScopeContract } from '@zenith/shared/open-platform';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { db } from '../../db';
import { apiScopes, oauth2Clients } from '../../db/schema';
import type { ApiScopeRow } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import type { CreateApiScopeInput, UpdateApiScopeInput } from '@zenith/shared/open-platform';

export function mapApiScope(row: ApiScopeRow, usedByAppCount = 0) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    scopeGroup: row.scopeGroup,
    status: row.status,
    /** 当前引用该 scope 的应用数量（引用中的 scope 不可删除） */
    usedByAppCount,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/**
 * 统计一批 scope 编码各自被多少个应用引用。
 * `oauth2_clients.allowed_scopes` 是 PG text[]，用 unnest 展开后聚合，避免 N 次数组包含查询。
 */
async function countScopeReferences(codes: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (codes.length === 0) return result;
  const rows = await db.execute<{ scope: string; count: string }>(sql`
    SELECT s.scope AS scope, COUNT(*)::text AS count
    FROM ${oauth2Clients} c, unnest(c.allowed_scopes) AS s(scope)
    WHERE s.scope IN ${codes}
    GROUP BY s.scope
  `);
  for (const row of rows) result.set(row.scope, Number(row.count));
  return result;
}

export async function listApiScopes(opts: QueryOutputOf<typeof apiScopeContract.list>) {
  const { page, pageSize, keyword, scopeGroup, status } = opts;
  const where = buildWhere(
    keywordCondition(keyword, [apiScopes.code, apiScopes.name], 'ilike'),
    scopeGroup ? eq(apiScopes.scopeGroup, scopeGroup) : undefined,
    status ? eq(apiScopes.status, status) : undefined,
  );

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(apiScopes, where),
    rows: async () => {
      const list = await db.select().from(apiScopes)
        .where(where)
        .orderBy(desc(apiScopes.createdAt))
        .limit(pageSize)
        .offset(pageOffset(page, pageSize));
      const refs = await countScopeReferences(list.map((row) => row.code));
      return list.map((row) => mapApiScope(row, refs.get(row.code) ?? 0));
    },
  });
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
  requireRow(row, 'API Scope 不存在');
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

/**
 * 删除 scope 前必须确认没有应用引用它。
 * scope 编码是应用配置里的字符串引用（allowed_scopes 数组），数据库层没有外键可依赖，
 * 直接删除会在应用侧留下悬挂 scope：授权页仍会展示它，网关校验却永远失败。
 */
async function ensureScopesUnreferenced(codes: string[]): Promise<void> {
  const refs = await countScopeReferences(codes);
  const referenced = codes.filter((code) => (refs.get(code) ?? 0) > 0);
  if (referenced.length === 0) return;
  const detail = referenced.map((code) => `${code}（${refs.get(code)} 个应用）`).join('、');
  throw new HTTPException(400, { message: `以下 scope 正被应用引用，无法删除：${detail}` });
}

export async function deleteApiScope(id: number) {
  const [existing] = await db.select({ code: apiScopes.code }).from(apiScopes)
    .where(eq(apiScopes.id, id))
    .limit(1);
  requireRow(existing, 'API Scope 不存在');
  await ensureScopesUnreferenced([existing.code]);
  const result = await db.delete(apiScopes).where(eq(apiScopes.id, id)).returning();
  requireRow(result[0], 'API Scope 不存在');
}

export async function batchDeleteApiScopes(ids: number[]) {
  if (ids.length === 0) return 0;
  const existing = await db.select({ code: apiScopes.code }).from(apiScopes)
    .where(inArray(apiScopes.id, ids));
  await ensureScopesUnreferenced(existing.map((row) => row.code));
  const result = await db.delete(apiScopes).where(inArray(apiScopes.id, ids)).returning();
  return result.length;
}
