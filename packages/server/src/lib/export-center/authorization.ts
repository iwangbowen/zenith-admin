import { createHash } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { stableStringify } from '@zenith/shared/core';
import { users } from '../../db/schema';
import { getDataScopeCondition } from '../data-scope';
import { getUserPermissions } from '../permissions';
import { getCreateTenantId } from '../tenant';
import type { JwtPayload } from '../../middleware/auth';
import type { AnyExportDefinition, ExportRuntimeContext } from './types';

export interface ExportAuthorization { version: 1; scopeFingerprint: string; rowKeys?: string[] }
export const exportRowKey = (row: Record<string, unknown>) => createHash('sha256').update(stableStringify(row.id == null ? ['value', row] : ['id', String(row.id)])).digest('hex');

export async function exportScopeFingerprint(definition: AnyExportDefinition, actor: JwtPayload) {
  const scope = await getDataScopeCondition({ currentUserId: actor.userId, permissions: [definition.permissions.export], deptColumn: users.departmentId, ownerColumn: users.id });
  const predicate = scope ? new PgDialect({ casing: 'snake_case' }).sqlToQuery(scope) : null;
  const permissions = [...await getUserPermissions(actor.userId)].sort();
  return createHash('sha256').update(stableStringify([actor.userId, getCreateTenantId(actor), [...actor.roles].sort(), permissions, predicate])).digest('hex');
}

export async function verifyExportRows(definition: AnyExportDefinition, ctx: ExportRuntimeContext, keys: readonly string[]) {
  if (!keys.length) return;
  const remaining = new Set(keys);
  const rows = await definition.streamRows(ctx.query, ctx.currentUser, ctx);
  let scanned = 0;
  for await (const row of rows) {
    if (++scanned > (ctx.rowLimit ?? 50000)) break;
    remaining.delete(exportRowKey(row));
    if (!remaining.size) return;
  }
  throw new HTTPException(403, { message: '导出源记录已变更或访问范围已收窄，请重新导出' });
}
