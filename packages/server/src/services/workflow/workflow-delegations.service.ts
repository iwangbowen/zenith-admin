import { workflowDelegationContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { workflowDelegations, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { isSuperAdmin } from '../../lib/permissions';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { pageOffset } from '../../lib/pagination';
import { formatNullableDateTime, formatTimestamps, parseDateTimeInput } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';
import type { DbExecutor } from '../../db/types';
import type { WorkflowDelegation, CreateWorkflowDelegationInput, UpdateWorkflowDelegationInput } from '@zenith/shared/workflow';
import { buildWhere } from '../../lib/where-helpers';

type DelegationRow = typeof workflowDelegations.$inferSelect;

function isActive(row: Pick<DelegationRow, 'enabled' | 'startAt' | 'endAt'>, now = new Date()): boolean {
  if (!row.enabled) return false;
  if (row.startAt && row.startAt.getTime() > now.getTime()) return false;
  if (row.endAt && row.endAt.getTime() < now.getTime()) return false;
  return true;
}

export function mapDelegation(
  row: DelegationRow,
  extras: { principalName?: string | null; delegateName?: string | null; definitionName?: string | null } = {},
): WorkflowDelegation {
  return {
    id: row.id,
    principalId: row.principalId,
    principalName: extras.principalName ?? null,
    delegateId: row.delegateId,
    delegateName: extras.delegateName ?? null,
    definitionId: row.definitionId ?? null,
    definitionName: extras.definitionName ?? null,
    mode: (row.mode ?? 'full') as 'full' | 'suggest',
    reason: row.reason ?? null,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    enabled: row.enabled,
    active: isActive(row),
    ...formatTimestamps(row),
  };
}

/**
 * 解析委托：返回 principal 当前生效的代理人及代理模式（无则返回 null）。
 * 在创建待审批任务时调用，将待办自动转交给代理人。仅解析一跳，避免链式循环。
 */
export async function resolveActiveDelegate(
  exec: DbExecutor,
  principalId: number,
  definitionId: number,
): Promise<{ delegateId: number; mode: 'full' | 'suggest' } | null> {
  const rows = await exec
    .select({ delegateId: workflowDelegations.delegateId, definitionId: workflowDelegations.definitionId, mode: workflowDelegations.mode, enabled: workflowDelegations.enabled, startAt: workflowDelegations.startAt, endAt: workflowDelegations.endAt })
    .from(workflowDelegations)
    .where(and(
      eq(workflowDelegations.principalId, principalId),
      eq(workflowDelegations.enabled, true),
      or(isNull(workflowDelegations.definitionId), eq(workflowDelegations.definitionId, definitionId)),
    ));
  const active = rows.filter((r) => isActive(r));
  if (active.length === 0) return null;
  // 流程专属委托优先于全局委托
  active.sort((a, b) => (b.definitionId ?? -1) - (a.definitionId ?? -1));
  const hit = active[0];
  return hit.delegateId === principalId ? null : { delegateId: hit.delegateId, mode: hit.mode ?? 'full' };
}

async function ensureUserExists(id: number, msg: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  requireRow(row, msg, 400);
}

async function ensureDelegationAccess(id: number): Promise<DelegationRow> {
  const user = currentUser();
  const [row] = await db.select().from(workflowDelegations)
    .where(buildWhere(eq(workflowDelegations.id, id), tenantCondition(workflowDelegations, user))).limit(1);
  requireRow(row, '委托规则不存在');
  if (!isSuperAdmin(user) && row.principalId !== user.userId) {
    throw new HTTPException(403, { message: '无权操作他人的委托规则' });
  }
  return row;
}

export async function getWorkflowDelegationBeforeAudit(id: number) {
  const row = await ensureDelegationAccess(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
  return row ? mapDelegation(row) : null;
}

export async function listWorkflowDelegations(q: QueryOutputOf<typeof workflowDelegationContract.list>) {
  const { page, pageSize } = q;
  const user = currentUser();
  const admin = isSuperAdmin(user);
  // 非管理员或显式 scope='mine'：仅本人作为委托人的规则；管理员可按 principalId 筛选
  const principalCondition = !admin || q.scope === 'mine'
    ? eq(workflowDelegations.principalId, user.userId)
    : q.principalId ? eq(workflowDelegations.principalId, q.principalId) : undefined;
  const where = buildWhere(tenantCondition(workflowDelegations, user), principalCondition);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowDelegations, where),
    rows: () => db.query.workflowDelegations.findMany({
      where,
      with: {
        principal: { columns: { nickname: true, username: true } },
        delegate: { columns: { nickname: true, username: true } },
        definition: { columns: { name: true } },
      },
      orderBy: desc(workflowDelegations.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: (r) => mapDelegation(r, {
      principalName: r.principal?.nickname ?? r.principal?.username ?? null,
      delegateName: r.delegate?.nickname ?? r.delegate?.username ?? null,
      definitionName: r.definition?.name ?? null,
    }),
  });
}

export async function createWorkflowDelegation(input: CreateWorkflowDelegationInput) {
  const user = currentUser();
  const principalId = input.principalId ?? user.userId;
  if (principalId !== user.userId && !isSuperAdmin(user)) {
    throw new HTTPException(403, { message: '只能为自己设置审批代理' });
  }
  if (input.delegateId === principalId) {
    throw new HTTPException(400, { message: '代理人不能是本人' });
  }
  await ensureUserExists(input.delegateId, '代理人不存在');
  if (input.principalId) await ensureUserExists(input.principalId, '委托人不存在');
  const startAt = input.startAt ? parseDateTimeInput(input.startAt) : null;
  const endAt = input.endAt ? parseDateTimeInput(input.endAt) : null;
  if (startAt && endAt && endAt.getTime() < startAt.getTime()) {
    throw new HTTPException(400, { message: '结束时间不能早于开始时间' });
  }
  const [row] = await db.insert(workflowDelegations).values({
    principalId,
    delegateId: input.delegateId,
    definitionId: input.definitionId ?? null,
    mode: input.mode ?? 'full',
    reason: input.reason ?? null,
    startAt,
    endAt,
    enabled: input.enabled ?? true,
    tenantId: getCreateTenantId(user),
  }).returning();
  return mapDelegation(row);
}

export async function updateWorkflowDelegation(id: number, input: UpdateWorkflowDelegationInput) {
  const existing = await ensureDelegationAccess(id);
  const patch: Partial<typeof workflowDelegations.$inferInsert> = {};
  if (input.delegateId !== undefined) {
    if (input.delegateId === existing.principalId) throw new HTTPException(400, { message: '代理人不能是本人' });
    await ensureUserExists(input.delegateId, '代理人不存在');
    patch.delegateId = input.delegateId;
  }
  if (input.definitionId !== undefined) patch.definitionId = input.definitionId ?? null;
  if (input.mode !== undefined) patch.mode = input.mode;
  if (input.reason !== undefined) patch.reason = input.reason ?? null;
  if (input.startAt !== undefined) patch.startAt = input.startAt ? parseDateTimeInput(input.startAt) : null;
  if (input.endAt !== undefined) patch.endAt = input.endAt ? parseDateTimeInput(input.endAt) : null;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  const [row] = await db.update(workflowDelegations).set(patch).where(eq(workflowDelegations.id, id)).returning();
  return mapDelegation(row);
}

export async function deleteWorkflowDelegation(id: number): Promise<void> {
  await ensureDelegationAccess(id);
  await db.delete(workflowDelegations).where(eq(workflowDelegations.id, id));
}
