import { and, asc, desc, eq, like, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import { workflowForms, workflowDefinitions } from '../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { escapeLike } from '../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import { pageOffset } from '../lib/pagination';
import { formatDateTime } from '../lib/datetime';
import type { WorkflowFormField, WorkflowFormSchema, WorkflowFormSettings, WorkflowFormStatus } from '@zenith/shared';
import type { DbExecutor } from '../db/types';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

type FormRow = typeof workflowForms.$inferSelect & {
  category?: { name: string | null } | null;
  createdByUser?: { nickname: string | null } | null;
};

export function mapForm(row: FormRow, usageCount?: number) {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    description: row.description ?? null,
    categoryId: row.categoryId ?? null,
    categoryName: row.category?.name ?? null,
    schema: (row.schema ?? null) as WorkflowFormSchema | null,
    status: row.status as WorkflowFormStatus,
    usageCount,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdByName: row.createdByUser?.nickname ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function findForm(id: number) {
  const tc = tenantCondition(workflowForms, currentUser());
  const conds = [eq(workflowForms.id, id)];
  if (tc) conds.push(tc);
  return and(...conds);
}

export async function ensureFormExists(id: number) {
  const [row] = await db.select().from(workflowForms).where(findForm(id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '表单不存在' });
  return row;
}

/**
 * 解析表单字段快照：实例发起时使用，用当前表单内容冻结进实例。
 * 不做租户过滤（表单已由流程定义绑定，内部解析）。
 */
export async function resolveFormSnapshot(
  formId: number | null | undefined,
  executor: DbExecutor = db,
): Promise<{ fields: WorkflowFormField[]; settings?: WorkflowFormSettings; name: string } | null> {
  if (!formId) return null;
  const [row] = await executor
    .select({ schema: workflowForms.schema, name: workflowForms.name })
    .from(workflowForms)
    .where(eq(workflowForms.id, formId))
    .limit(1);
  if (!row) return null;
  const schema = (row.schema ?? null) as WorkflowFormSchema | null;
  return { fields: schema?.fields ?? [], settings: schema?.settings, name: row.name };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

async function countUsage(formIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (formIds.length === 0) return map;
  const rows = await db
    .select({ formId: workflowDefinitions.formId, count: sql<number>`count(*)::int` })
    .from(workflowDefinitions)
    .where(inArray(workflowDefinitions.formId, formIds))
    .groupBy(workflowDefinitions.formId);
  for (const r of rows) {
    if (r.formId != null) map.set(r.formId, Number(r.count));
  }
  return map;
}

export async function listWorkflowForms(query: { page?: number; pageSize?: number; keyword?: string; status?: WorkflowFormStatus; categoryId?: number }) {
  const { page = 1, pageSize = 20, keyword, status, categoryId } = query;
  const tc = tenantCondition(workflowForms, currentUser());
  const conds = [];
  if (tc) conds.push(tc);
  if (keyword) conds.push(like(workflowForms.name, `%${escapeLike(keyword)}%`));
  if (status) conds.push(eq(workflowForms.status, status));
  if (categoryId) conds.push(eq(workflowForms.categoryId, categoryId));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowForms, where),
    db.query.workflowForms.findMany({
      where,
      with: {
        category: { columns: { name: true } },
        createdByUser: { columns: { nickname: true } },
      },
      orderBy: desc(workflowForms.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  const usage = await countUsage(rows.map((r) => r.id));
  return { list: rows.map((r) => mapForm(r, usage.get(r.id) ?? 0)), total, page, pageSize };
}

/** 流程设计器下拉选用：仅启用的表单，最小字段 */
export async function listEnabledWorkflowForms() {
  const tc = tenantCondition(workflowForms, currentUser());
  const conds = [eq(workflowForms.status, 'enabled')];
  if (tc) conds.push(tc);
  const rows = await db.query.workflowForms.findMany({
    where: and(...conds),
    with: { category: { columns: { name: true } } },
    orderBy: [asc(workflowForms.name), desc(workflowForms.id)],
  });
  return rows.map((r) => mapForm(r));
}

export async function getWorkflowForm(id: number) {
  const row = await db.query.workflowForms.findFirst({
    where: findForm(id),
    with: {
      category: { columns: { name: true } },
      createdByUser: { columns: { nickname: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '表单不存在' });
  const usage = await db.$count(workflowDefinitions, eq(workflowDefinitions.formId, id));
  return mapForm(row, usage);
}

export interface CreateWorkflowFormInput {
  name: string;
  code?: string | null;
  description?: string | null;
  categoryId?: number | null;
  schema?: Record<string, unknown> | null;
  status?: WorkflowFormStatus;
}

export async function createWorkflowForm(input: CreateWorkflowFormInput) {
  try {
    const [row] = await db.insert(workflowForms).values({
      name: input.name,
      code: input.code ?? null,
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      schema: input.schema ?? null,
      status: input.status ?? 'enabled',
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapForm(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '表单编码已存在');
  }
}

export type UpdateWorkflowFormInput = Partial<CreateWorkflowFormInput>;

export async function updateWorkflowForm(id: number, input: UpdateWorkflowFormInput) {
  await ensureFormExists(id);
  const tc = tenantCondition(workflowForms, currentUser());
  const conds = [eq(workflowForms.id, id)];
  if (tc) conds.push(tc);
  try {
    const patch: Partial<typeof workflowForms.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.code !== undefined) patch.code = input.code;
    if (input.description !== undefined) patch.description = input.description;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.schema !== undefined) patch.schema = input.schema;
    if (input.status !== undefined) patch.status = input.status;
    const [row] = await db.update(workflowForms).set(patch).where(and(...conds)).returning();
    if (!row) throw new HTTPException(404, { message: '表单不存在' });
    return mapForm(row);
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '表单编码已存在');
  }
}

export async function deleteWorkflowForm(id: number): Promise<void> {
  await ensureFormExists(id);
  const used = await db.$count(workflowDefinitions, eq(workflowDefinitions.formId, id));
  if (used > 0) throw new HTTPException(400, { message: '该表单已被流程引用，无法删除' });
  const tc = tenantCondition(workflowForms, currentUser());
  const conds = [eq(workflowForms.id, id)];
  if (tc) conds.push(tc);
  await db.delete(workflowForms).where(and(...conds));
}
