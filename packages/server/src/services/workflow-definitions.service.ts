import { workflowDefinitions, workflowDefinitionVersions, workflowForms, workflowCategories, workflowInstances, users, userRoles } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import type { WorkflowFormSchema, WorkflowCustomFormConfig, WorkflowFormType } from '@zenith/shared';

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
    formType: (row.formType ?? 'designer') as WorkflowFormType,
    customForm: (row.customForm ?? null) as WorkflowCustomFormConfig | null,
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
    formType: (row.formType ?? 'designer') as WorkflowFormType,
    customForm: (row.customForm ?? null) as WorkflowCustomFormConfig | null,
    publishedAt: formatDateTime(row.publishedAt),
    publishedBy: row.publishedBy ?? null,
    publishedByName: publishedByName ?? null,
    tenantId: row.tenantId,
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { eq, and, like, desc, inArray, ne } from 'drizzle-orm';
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

function hasBusinessFormConfig(formType: WorkflowFormType): formType is 'custom' | 'external' {
  return formType === 'custom' || formType === 'external';
}

function validateBusinessFormConfigForPublish(
  formType: WorkflowFormType,
  customForm: unknown,
): void {
  if (formType === 'custom') {
    const cf = customForm as WorkflowCustomFormConfig | null;
    if (!cf?.createComponent?.trim()) {
      throw new HTTPException(400, { message: '请先在「表单」步骤配置自定义业务表单的创建页组件路径' });
    }
  } else if (formType === 'external') {
    const cf = customForm as WorkflowCustomFormConfig | null;
    if (!cf?.viewComponent?.trim()) {
      throw new HTTPException(400, { message: '请先在「表单」步骤配置业务系统主导流程的审批查看页组件路径' });
    }
  }
}

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
  const conditions = [eq(workflowDefinitions.status, 'published'), ne(workflowDefinitions.formType, 'external')];
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
  name: string; description?: string | null; categoryId?: number | null; initiatorScopeType?: WorkflowInitiatorScopeType; initiatorScopeIds?: number[] | null; flowData?: unknown; formId?: number | null; formType?: WorkflowFormType; customForm?: WorkflowCustomFormConfig | null; status?: WorkflowDefinitionStatus;
}) {
  const user = currentUser();
  const scopeType = data.initiatorScopeType ?? 'all';
  const scopeIds = scopeType === 'all' ? null : normalizeScopeIds(data.initiatorScopeIds);
  const formType = data.formType ?? 'designer';
  if (formType === 'designer' && data.formId != null) await ensureFormExists(data.formId);
  // 禁止经 create 直接发布：发布必须走 publishDefinition（含 validateFlowData 校验与版本快照）
  const initialStatus = (data.status ?? 'draft') === 'published' ? 'draft' : (data.status ?? 'draft');
  const [row] = await db.insert(workflowDefinitions).values({
    name: data.name,
    description: data.description ?? null,
    categoryId: data.categoryId ?? null,
    initiatorScopeType: scopeType,
    initiatorScopeIds: scopeIds,
    flowData: data.flowData ?? null,
    formId: formType === 'designer' ? (data.formId ?? null) : null,
    formType,
    customForm: hasBusinessFormConfig(formType) ? (data.customForm ?? null) : null,
    status: initialStatus,
    tenantId: getCreateTenantId(user),
  }).returning();
  return getDefinition(row.id);
}

export async function updateDefinition(id: number, data: Partial<{
  name: string; description: string | null; categoryId: number | null; initiatorScopeType: WorkflowInitiatorScopeType; initiatorScopeIds: number[] | null; flowData: unknown; formId: number | null; formType: WorkflowFormType; customForm: WorkflowCustomFormConfig | null; status: WorkflowDefinitionStatus;
}>) {
  const where = findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new HTTPException(404, { message: '流程定义不存在' });
  // 解析最终的表单类型（本次更新值优先，否则取库中现值），用于条件写入两类表单字段
  const nextFormType = (data.formType ?? existing.formType ?? 'designer') as WorkflowFormType;
  if (nextFormType === 'designer' && data.formId != null) await ensureFormExists(data.formId);
  const updateData: Record<string, unknown> = { ...data };
  if (data.flowData !== undefined) updateData.flowData = data.flowData;
  if (data.formType !== undefined) updateData.formType = data.formType;
  // 切到业务表单时清空表单库引用；切到设计器表单时清空业务表单配置，避免脏数据
  if (hasBusinessFormConfig(nextFormType)) {
    updateData.formId = null;
    if (data.customForm !== undefined) updateData.customForm = data.customForm;
    else if (data.formType !== undefined) updateData.customForm = existing.customForm ?? null;
  } else {
    updateData.customForm = null;
    if (data.formId !== undefined) updateData.formId = data.formId;
  }
  // 禁止经 update 直接发布：发布必须走 publishDefinition（含校验与版本快照），避免绕过校验上线无效流程
  if (updateData.status === 'published') updateData.status = 'draft';
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
  validateBusinessFormConfigForPublish((existing.formType ?? 'designer') as WorkflowFormType, existing.customForm);
  const user = currentUser();
  const updated = await db.transaction(async (tx) => {
    // 行级锁 + 锁内重算版本号：避免并发发布同一定义争用 (definitionId, version) 唯一约束
    const [locked] = await tx.select().from(workflowDefinitions).where(where).for('update').limit(1);
    if (!locked) throw new HTTPException(404, { message: '流程定义不存在' });
    const newVersion = locked.version + 1;
    await tx.insert(workflowDefinitionVersions).values({
      definitionId: locked.id,
      version: newVersion,
      name: locked.name,
      description: locked.description,
      flowData: locked.flowData,
      formId: locked.formId,
      formType: locked.formType,
      customForm: locked.customForm,
      publishedBy: user?.userId ?? null,
      tenantId: locked.tenantId,
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
    formType: ver.formType,
    customForm: ver.customForm,
    status: 'draft',
  }).where(where).returning();
  return getDefinition(updated.id);
}

// ─── G4 复制流程 / G5 导出导入 / G6 版本对比 ──────────────────────────────────

/** G4 复制流程：克隆定义（及其表单）为新草稿 */
export async function duplicateDefinition(id: number) {
  const where = findDefinition(id);
  const src = await db.query.workflowDefinitions.findFirst({
    where,
    with: { form: { columns: { name: true, description: true, schema: true } } },
  });
  if (!src) throw new HTTPException(404, { message: '流程定义不存在' });
  const user = currentUser();
  const tenantId = getCreateTenantId(user);
  const newId = await db.transaction(async (tx) => {
    let newFormId: number | null = null;
    if (src.formId != null && src.form) {
      const [newForm] = await tx.insert(workflowForms).values({
        name: `${src.form.name ?? '表单'} 副本`,
        code: null,
        description: src.form.description ?? null,
        schema: src.form.schema ?? null,
        status: 'enabled',
        tenantId,
      }).returning();
      newFormId = newForm.id;
    }
    const [row] = await tx.insert(workflowDefinitions).values({
      name: `${src.name} 副本`,
      description: src.description ?? null,
      categoryId: src.categoryId ?? null,
      initiatorScopeType: src.initiatorScopeType ?? 'all',
      initiatorScopeIds: src.initiatorScopeIds ?? null,
      flowData: src.flowData ?? null,
      formId: newFormId,
      formType: src.formType,
      customForm: src.customForm,
      status: 'draft',
      tenantId,
    }).returning();
    return row.id;
  });
  return getDefinition(newId);
}

/** G5 导出流程定义为自包含 JSON（含表单 schema） */
export async function exportDefinition(id: number) {
  const row = await db.query.workflowDefinitions.findFirst({
    where: findDefinition(id),
    with: {
      category: { columns: { name: true } },
      form: { columns: { name: true, description: true, schema: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '流程定义不存在' });
  return {
    name: row.name,
    description: row.description ?? null,
    categoryName: row.category?.name ?? null,
    flowData: row.flowData ?? null,
    formType: (row.formType ?? 'designer') as WorkflowFormType,
    customForm: (row.customForm ?? null) as WorkflowCustomFormConfig | null,
    form: row.form
      ? { name: row.form.name ?? '表单', description: row.form.description ?? null, schema: row.form.schema ?? null }
      : null,
    exportedAt: formatDateTime(new Date()),
    schemaVersion: 1,
  };
}

/** G5 从导出 JSON 导入为新草稿（按分类名匹配既有分类，找不到则忽略） */
export async function importDefinition(data: {
  name: string;
  description?: string | null;
  categoryName?: string | null;
  flowData?: unknown;
  formType?: WorkflowFormType;
  customForm?: WorkflowCustomFormConfig | null;
  form?: { name: string; description?: string | null; schema?: unknown } | null;
}) {
  const user = currentUser();
  const tenantId = getCreateTenantId(user);
  const formType = data.formType ?? 'designer';
  let categoryId: number | null = null;
  if (data.categoryName) {
    const tc = tenantCondition(workflowCategories, user);
    const conds = [eq(workflowCategories.name, data.categoryName)];
    if (tc) conds.push(tc);
    const [cat] = await db.select({ id: workflowCategories.id }).from(workflowCategories).where(and(...conds)).limit(1);
    categoryId = cat?.id ?? null;
  }
  const newId = await db.transaction(async (tx) => {
    let newFormId: number | null = null;
    if (formType === 'designer' && data.form) {
      const [newForm] = await tx.insert(workflowForms).values({
        name: data.form.name || '导入表单',
        code: null,
        description: data.form.description ?? null,
        schema: (data.form.schema ?? null) as Record<string, unknown> | null,
        status: 'enabled',
        tenantId,
      }).returning();
      newFormId = newForm.id;
    }
    const [row] = await tx.insert(workflowDefinitions).values({
      name: data.name,
      description: data.description ?? null,
      categoryId,
      flowData: (data.flowData ?? null) as WorkflowFlowData | null,
      formId: newFormId,
      formType,
      customForm: hasBusinessFormConfig(formType) ? (data.customForm ?? null) : null,
      status: 'draft',
      tenantId,
    }).returning();
    return row.id;
  });
  return getDefinition(newId);
}

/** G6 版本对比：返回两个版本的快照供前端 diff（leftId/rightId 任一为 0 表示当前草稿） */
export async function diffVersions(definitionId: number, leftId: number, rightId: number) {
  const where = findDefinition(definitionId);
  const [def] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!def) throw new HTTPException(404, { message: '流程定义不存在' });

  const loadSide = async (versionId: number) => {
    if (versionId === 0) {
      return {
        version: def.version,
        name: def.name,
        label: `当前（v${def.version}）`,
        flowData: def.flowData ?? null,
        publishedAt: null as string | null,
      };
    }
    const [ver] = await db.select().from(workflowDefinitionVersions)
      .where(and(eq(workflowDefinitionVersions.id, versionId), eq(workflowDefinitionVersions.definitionId, definitionId)))
      .limit(1);
    if (!ver) throw new HTTPException(404, { message: '历史版本不存在' });
    return {
      version: ver.version,
      name: ver.name,
      label: `v${ver.version}`,
      flowData: ver.flowData ?? null,
      publishedAt: formatDateTime(ver.publishedAt),
    };
  };

  const [left, right] = await Promise.all([loadSide(leftId), loadSide(rightId)]);
  return { left, right };
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
  const instanceCount = await db.$count(workflowInstances, eq(workflowInstances.definitionId, id));
  if (instanceCount > 0) {
    throw new HTTPException(400, { message: `该流程已存在 ${instanceCount} 条发起实例，无法删除（如需停止发起请使用「禁用」）` });
  }
  await db.delete(workflowDefinitions).where(where);
}

export async function batchDisableDefinitions(ids: number[]) {
  if (!ids.length) return { updated: 0, skipped: 0 };
  const tc = tenantCondition(workflowDefinitions, currentUser());
  const conds = [inArray(workflowDefinitions.id, ids), eq(workflowDefinitions.status, 'published')];
  if (tc) conds.push(tc);
  const rows = await db.update(workflowDefinitions).set({ status: 'disabled' }).where(and(...conds)).returning({ id: workflowDefinitions.id });
  return { updated: rows.length, skipped: ids.length - rows.length };
}

export async function batchEnableDefinitions(ids: number[]) {
  if (!ids.length) return { updated: 0, skipped: 0 };
  const tc = tenantCondition(workflowDefinitions, currentUser());
  const conds = [inArray(workflowDefinitions.id, ids), eq(workflowDefinitions.status, 'disabled')];
  if (tc) conds.push(tc);
  const rows = await db.update(workflowDefinitions).set({ status: 'published' }).where(and(...conds)).returning({ id: workflowDefinitions.id });
  return { updated: rows.length, skipped: ids.length - rows.length };
}

export async function batchDeleteDefinitions(ids: number[]) {
  if (!ids.length) return { deleted: 0, skipped: 0 };
  const tc = tenantCondition(workflowDefinitions, currentUser());
  const scopeConds = [inArray(workflowDefinitions.id, ids), ne(workflowDefinitions.status, 'published')];
  if (tc) scopeConds.push(tc);
  const candidates = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(...scopeConds));
  const candidateIds = candidates.map((row) => row.id);
  if (!candidateIds.length) return { deleted: 0, skipped: ids.length };
  const used = await db
    .selectDistinct({ definitionId: workflowInstances.definitionId })
    .from(workflowInstances)
    .where(inArray(workflowInstances.definitionId, candidateIds));
  const blocked = new Set(used.map((row) => row.definitionId));
  const deletableIds = candidateIds.filter((id) => !blocked.has(id));
  if (deletableIds.length) {
    await db.delete(workflowDefinitions).where(inArray(workflowDefinitions.id, deletableIds));
  }
  return { deleted: deletableIds.length, skipped: ids.length - deletableIds.length };
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

export async function getWorkflowDefinitionsBeforeAudit(ids: number[]) {
  if (!ids.length) return [];
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [inArray(workflowDefinitions.id, ids)];
  if (tc) conds.push(tc);
  const rows = await db.query.workflowDefinitions.findMany({
    where: and(...conds),
    with: {
      createdByUser: { columns: { nickname: true } },
      category: { columns: { name: true, color: true, icon: true } },
      form: { columns: { name: true, schema: true } },
    },
    orderBy: desc(workflowDefinitions.id),
  });
  return rows.map((row) => mapDefinition(row, row.createdByUser?.nickname ?? null));
}
