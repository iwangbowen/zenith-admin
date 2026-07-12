import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db';
import { workflowDelegations, users } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { isSuperAdmin } from '../../lib/permissions';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';
import type { DbExecutor } from '../../db/types';
import type {
  WorkflowDelegation,
  CreateWorkflowDelegationInput,
  UpdateWorkflowDelegationInput,
} from '@zenith/shared';

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
    reason: row.reason ?? null,
    startAt: formatNullableDateTime(row.startAt),
    endAt: formatNullableDateTime(row.endAt),
    enabled: row.enabled,
    active: isActive(row),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/**
 * 解析委托：返回 principal 当前生效的代理人 userId（无则返回 null）。
 * 在创建待审批任务时调用，将待办自动转交给代理人。仅解析一跳，避免链式循环。
 */
export async function resolveActiveDelegate(
  exec: DbExecutor,
  principalId: number,
  definitionId: number,
): Promise<number | null> {
  const rows = await exec
    .select({ delegateId: workflowDelegations.delegateId, definitionId: workflowDelegations.definitionId, enabled: workflowDelegations.enabled, startAt: workflowDelegations.startAt, endAt: workflowDelegations.endAt })
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
  const delegateId = active[0].delegateId;
  return delegateId === principalId ? null : delegateId;
}

async function ensureUserExists(id: number, msg: string) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!row) throw new HTTPException(400, { message: msg });
}

async function ensureDelegationAccess(id: number): Promise<DelegationRow> {
  const user = currentUser();
  const tc = tenantCondition(workflowDelegations, user);
  const conds = [eq(workflowDelegations.id, id)];
  if (tc) conds.push(tc);
  const [row] = await db.select().from(workflowDelegations).where(and(...conds)).limit(1);
  if (!row) throw new HTTPException(404, { message: '委托规则不存在' });
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

export interface ListWorkflowDelegationsQuery {
  page?: number;
  pageSize?: number;
  principalId?: number;
  /** scope='mine' 仅本人；'all' 管理员全部（默认） */
  scope?: 'mine' | 'all';
}

export async function listWorkflowDelegations(q: ListWorkflowDelegationsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const user = currentUser();
  const admin = isSuperAdmin(user);
  const tc = tenantCondition(workflowDelegations, user);
  const conds = [];
  if (tc) conds.push(tc);
  // 非管理员或显式 scope='mine'：仅本人作为委托人的规则
  if (!admin || q.scope === 'mine') {
    conds.push(eq(workflowDelegations.principalId, user.userId));
  } else if (q.principalId) {
    conds.push(eq(workflowDelegations.principalId, q.principalId));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowDelegations, where),
    db.query.workflowDelegations.findMany({
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
  ]);
  const list = rows.map((r) => mapDelegation(r, {
    principalName: r.principal?.nickname ?? r.principal?.username ?? null,
    delegateName: r.delegate?.nickname ?? r.delegate?.username ?? null,
    definitionName: r.definition?.name ?? null,
  }));
  return { list, total, page, pageSize };
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
