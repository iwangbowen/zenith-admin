import { workflowDefinitions, workflowDefinitionVersions, workflowForms, users, userRoles } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import type { WorkflowFormSchema } from '@zenith/shared';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapDefinition(
  row: typeof workflowDefinitions.$inferSelect & {
    category?: { name: string | null; color: string | null; icon: string | null } | null;
    form?: { name: string | null; schema: unknown } | null;
  },
  createdByName?: string | null,
) {
  const initiatorScopeIds = Array.isArray(row.initiatorScopeIds)
    ? row.initiatorScopeIds.map(Number).filter((v) => Number.isInteger(v) && v > 0)
    : null;
  const formSchema = (row.form?.schema ?? null) as WorkflowFormSchema | null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categoryId: row.categoryId ?? null,
    initiatorScopeType: (row.initiatorScopeType ?? 'all') as 'all' | 'users' | 'departments' | 'roles',
    initiatorScopeIds,
    categoryName: row.category?.name ?? null,
    categoryColor: row.category?.color ?? null,
    categoryIcon: row.category?.icon ?? null,
    flowData: row.flowData,
    formId: row.formId ?? null,
    formName: row.form?.name ?? null,
    formFields: formSchema?.fields ?? null,
    formSettings: formSchema?.settings ?? null,
    status: row.status,
    version: row.version,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdByName: createdByName ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export function mapDefinitionVersion(
  row: typeof workflowDefinitionVersions.$inferSelect,
  publishedByName?: string | null,
  form?: { name: string | null; schema: unknown } | null,
) {
  const formSchema = (form?.schema ?? null) as WorkflowFormSchema | null;
  return {
    id: row.id,
    definitionId: row.definitionId,
    version: row.version,
    name: row.name,
    description: row.description,
    flowData: row.flowData,
    formId: row.formId ?? null,
    formName: form?.name ?? null,
    formFields: formSchema?.fields ?? null,
    publishedAt: formatDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    publishedByName: publishedByName ?? null,
    tenantId: row.tenantId,
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { eq, and, like, desc, inArray } from 'drizzle-orm';
import { escapeLike } from '../lib/where-helpers';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { validateFlowData } from '../lib/workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { ensureFormExists } from './workflow-forms.service';

export type WorkflowDefinitionStatus = 'draft' | 'published' | 'disabled';
type WorkflowInitiatorScopeType = 'all' | 'users' | 'departments' | 'roles';

function normalizeScopeIds(ids: unknown): number[] {
  if (!Array.isArray(ids)) return [];
  return ids.map(Number).filter((v) => Number.isInteger(v) && v > 0);
}

function canUserInitiateByScope(
  definition: typeof workflowDefinitions.$inferSelect,
  me: { userId: number; departmentId: number | null; roleIds: number[] },
): boolean {
  const scopeType = (definition.initiatorScopeType ?? 'all') as WorkflowInitiatorScopeType;
  const ids = normalizeScopeIds(definition.initiatorScopeIds);
  if (scopeType === 'all') return true;
  if (ids.length === 0) return false;
  if (scopeType === 'users') return ids.includes(me.userId);
  if (scopeType === 'departments') return me.departmentId != null && ids.includes(me.departmentId);
  if (scopeType === 'roles') return me.roleIds.some((id) => ids.includes(id));
  return false;
}

export async function listDefinitions(query: { page?: number; pageSize?: number; keyword?: string; status?: string; categoryId?: number }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword, status, categoryId } = query;
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(like(workflowDefinitions.name, `%${escapeLike(keyword)}%`));
  if (status) conditions.push(eq(workflowDefinitions.status, status as WorkflowDefinitionStatus));
  if (categoryId) conditions.push(eq(workflowDefinitions.categoryId, categoryId));
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowDefinitions, where),
    db.query.workflowDefinitions.findMany({
      where,
      with: {
        createdByUser: { columns: { nickname: true } },
        category: { columns: { name: true, color: true, icon: true } },
        form: { columns: { name: true, schema: true } },
      },
      orderBy: desc(workflowDefinitions.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(r => mapDefinition(r, r.createdByUser?.nickname ?? null)), total, page, pageSize };
}

export async function listPublishedDefinitions() {
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.status, 'published')];
  if (tc) conditions.push(tc);
  const [rows, me, roleRows] = await Promise.all([
    db.query.workflowDefinitions.findMany({
      where: and(...conditions),
      with: { form: { columns: { name: true, schema: true } } },
      orderBy: desc(workflowDefinitions.updatedAt),
    }),
    db.select({ departmentId: users.departmentId }).from(users).where(eq(users.id, user.userId)).limit(1),
    db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.userId)),
  ]);
  const roleIds = roleRows.map((r) => r.roleId);
  const meInfo = {
    userId: user.userId,
    departmentId: me[0]?.departmentId ?? null,
    roleIds,
  };
  const filtered = rows.filter((r) => canUserInitiateByScope(r, meInfo));
  return filtered.map((r) => mapDefinition(r));
}

function findDefinition(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [eq(workflowDefinitions.id, id)];
  if (tc) conds.push(tc);
  return and(...conds);
}

export async function getDefinition(id: number) {
  const where = findDefinition(id);
  const row = await db.query.workflowDefinitions.findFirst({
    where,
    with: {
      createdByUser: { columns: { nickname: true } },
      category: { columns: { name: true, color: true, icon: true } },
      form: { columns: { name: true, schema: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程定义不存在' });
  return mapDefinition(row, row.createdByUser?.nickname ?? null);
}

export async function createDefinition(data: {
  name: string; description?: string | null; categoryId?: number | null; initiatorScopeType?: WorkflowInitiatorScopeType; initiatorScopeIds?: number[] | null; flowData?: unknown; formId?: number | null; status?: WorkflowDefinitionStatus;
}) {
  const user = currentUser();
  const scopeType = data.initiatorScopeType ?? 'all';
  const scopeIds = scopeType === 'all' ? null : normalizeScopeIds(data.initiatorScopeIds);
  if (data.formId != null) await ensureFormExists(data.formId);
  const [row] = await db.insert(workflowDefinitions).values({
    name: data.name,
    description: data.description ?? null,
    categoryId: data.categoryId ?? null,
    initiatorScopeType: scopeType,
    initiatorScopeIds: scopeIds,
    flowData: data.flowData ?? null,
    formId: data.formId ?? null,
    status: data.status ?? 'draft',
    tenantId: getCreateTenantId(user),
  }).returning();
  return getDefinition(row.id);
}

export async function updateDefinition(id: number, data: Partial<{
  name: string; description: string | null; categoryId: number | null; initiatorScopeType: WorkflowInitiatorScopeType; initiatorScopeIds: number[] | null; flowData: unknown; formId: number | null; status: WorkflowDefinitionStatus;
}>) {
  const where = findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new HTTPException(404, { message: '流程定义不存在' });
  if (data.formId != null) await ensureFormExists(data.formId);
  const updateData: Record<string, unknown> = { ...data };
  if (data.flowData !== undefined) updateData.flowData = data.flowData;
  if (data.formId !== undefined) updateData.formId = data.formId;
  if (data.initiatorScopeType !== undefined) {
    const scopeType = data.initiatorScopeType;
    updateData.initiatorScopeType = scopeType;
    updateData.initiatorScopeIds = scopeType === 'all' ? null : normalizeScopeIds(data.initiatorScopeIds);
  } else if (data.initiatorScopeIds !== undefined) {
    const currentType = (existing.initiatorScopeType ?? 'all') as WorkflowInitiatorScopeType;
    updateData.initiatorScopeIds = currentType === 'all' ? null : normalizeScopeIds(data.initiatorScopeIds);
  }
  // 已发布的流程被修改后自动回到草稿，需重新发布
  if (existing.status === 'published' && data.status === undefined) {
    updateData.status = 'draft';
  }
  const [updated] = await db
    .update(workflowDefinitions)
    .set(updateData as Partial<typeof workflowDefinitions.$inferInsert>)
    .where(where)
    .returning();
  if (!updated) throw new HTTPException(404, { message: '流程定义不存在' });
  return getDefinition(updated.id);
}

export async function publishDefinition(id: number) {
  const where = findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new HTTPException(404, { message: '流程定义不存在' });
  const flowData = existing.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes) throw new HTTPException(400, { message: '请先在设计器中设计流程' });
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new HTTPException(400, { message: validation.errors[0] });
  const user = currentUser();
  const newVersion = existing.version + 1;
  const updated = await db.transaction(async (tx) => {
    await tx.insert(workflowDefinitionVersions).values({
      definitionId: existing.id,
      version: newVersion,
      name: existing.name,
      description: existing.description,
      flowData: existing.flowData,
      formId: existing.formId,
      publishedBy: user?.userId ?? null,
      tenantId: existing.tenantId,
    });
    const [u] = await tx
      .update(workflowDefinitions)
      .set({ status: 'published', version: newVersion })
      .where(where)
      .returning();
    return u;
  });
  return getDefinition(updated.id);
}

export async function listVersions(definitionId: number) {
  // 校验定义存在 + 租户可见
  const [def] = await db.select().from(workflowDefinitions).where(findDefinition(definitionId)).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  const rows = await db.query.workflowDefinitionVersions.findMany({
    where: eq(workflowDefinitionVersions.definitionId, definitionId),
    with: { publishedByUser: { columns: { nickname: true } } },
    orderBy: desc(workflowDefinitionVersions.version),
  });
  const formIds = [...new Set(rows.map((r) => r.formId).filter((v): v is number => v != null))];
  const formMap = new Map<number, { name: string | null; schema: unknown }>();
  if (formIds.length > 0) {
    const forms = await db
      .select({ id: workflowForms.id, name: workflowForms.name, schema: workflowForms.schema })
      .from(workflowForms)
      .where(inArray(workflowForms.id, formIds));
    for (const f of forms) formMap.set(f.id, { name: f.name, schema: f.schema });
  }
  return rows.map(r => mapDefinitionVersion(r, r.publishedByUser?.nickname ?? null, r.formId != null ? formMap.get(r.formId) ?? null : null));
}

export async function restoreVersion(definitionId: number, versionId: number) {
  const where = findDefinition(definitionId);
  const [def] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });
  const [ver] = await db.select().from(workflowDefinitionVersions)
    .where(and(eq(workflowDefinitionVersions.id, versionId), eq(workflowDefinitionVersions.definitionId, definitionId)))
    .limit(1);
  if (!ver) throw new HTTPException(404, { message: '历史版本不存在' });
  const [updated] = await db.update(workflowDefinitions).set({
    name: ver.name,
    description: ver.description,
    flowData: ver.flowData,
    formId: ver.formId,
    status: 'draft',
  }).where(where).returning();
  return getDefinition(updated.id);
}

export async function disableDefinition(id: number) {
  const where = findDefinition(id);
  const [updated] = await db.update(workflowDefinitions).set({ status: 'disabled' }).where(where).returning();
  if (!updated) throw new HTTPException(404, { message: '流程定义不存在' });
  return mapDefinition(updated);
}

export async function enableDefinition(id: number) {
  const where = and(findDefinition(id), eq(workflowDefinitions.status, 'disabled'));
  const [updated] = await db.update(workflowDefinitions).set({ status: 'published' }).where(where).returning();
  if (!updated) throw new HTTPException(400, { message: '流程定义不存在或不处于禁用状态' });
  return mapDefinition(updated);
}

export async function deleteDefinition(id: number) {
  const where = findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new HTTPException(404, { message: '流程定义不存在' });
  if (existing.status === 'published') throw new HTTPException(400, { message: '已发布的流程不能删除，请先禁用' });
  await db.delete(workflowDefinitions).where(where);
}

export async function getWorkflowDefinitionBeforeAudit(id: number) {
  const row = await db.query.workflowDefinitions.findFirst({
    where: findDefinition(id),
    with: {
      createdByUser: { columns: { nickname: true } },
      category: { columns: { name: true, color: true, icon: true } },
      form: { columns: { name: true, schema: true } },
    },
  });
  if (!row) return null;
  return mapDefinition(row, row.createdByUser?.nickname ?? null);
}
