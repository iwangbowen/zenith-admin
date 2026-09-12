import { workflowCategoryContract } from '@zenith/shared/workflow';
import type { QueryOutputOf } from '@zenith/shared/core';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import { workflowCategories, workflowDefinitions } from '../../db/schema';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import { pageOffset } from '../../lib/pagination';
import { formatTimestamps } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { requireRow } from '../../lib/db-assert';

export function mapCategory(row: typeof workflowCategories.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    icon: row.icon ?? null,
    color: row.color ?? null,
    sort: row.sort,
    description: row.description ?? null,
    tenantId: row.tenantId,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureCategoryExists(id: number) {
  const [row] = await db.select().from(workflowCategories)
    .where(buildWhere(eq(workflowCategories.id, id), tenantCondition(workflowCategories, currentUser()))).limit(1);
  return requireRow(row, '流程分类不存在');
}

export async function listWorkflowCategories(q: QueryOutputOf<typeof workflowCategoryContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(tenantCondition(workflowCategories, currentUser()), keywordCondition(q.keyword, [workflowCategories.name]));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(workflowCategories, where),
    rows: () => db.select().from(workflowCategories).where(where).orderBy(asc(workflowCategories.sort), desc(workflowCategories.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
    map: mapCategory,
  });
}

export async function listAllWorkflowCategories() {
  const tc = tenantCondition(workflowCategories, currentUser());
  const rows = await db.select().from(workflowCategories).where(tc).orderBy(asc(workflowCategories.sort), desc(workflowCategories.id));
  return rows.map(mapCategory);
}

export async function getWorkflowCategory(id: number) {
  const row = await ensureCategoryExists(id);
  return mapCategory(row);
}

export async function getWorkflowCategoryBeforeAudit(id: number) {
  return getWorkflowCategory(id).catch((err) => {
    if (err instanceof HTTPException && err.status === 404) return null;
    throw err;
  });
}

export interface CreateWorkflowCategoryInput {
  name: string;
  code?: string | null;
  icon?: string | null;
  color?: string | null;
  sort?: number;
  description?: string | null;
}

export async function createWorkflowCategory(input: CreateWorkflowCategoryInput) {
  try {
    const [row] = await db.insert(workflowCategories).values({
      name: input.name,
      code: input.code ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      sort: input.sort ?? 0,
      description: input.description ?? null,
      tenantId: getCreateTenantId(currentUser()),
    }).returning();
    return mapCategory(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '分类编码已存在');
  }
}

export type UpdateWorkflowCategoryInput = Partial<CreateWorkflowCategoryInput>;

export async function updateWorkflowCategory(id: number, input: UpdateWorkflowCategoryInput) {
  await ensureCategoryExists(id);
  try {
    const patch: Partial<typeof workflowCategories.$inferInsert> = {};
    if (input.name === undefined) { /* skip */ } else { patch.name = input.name; }
    if (input.code === undefined) { /* skip */ } else { patch.code = input.code; }
    if (input.icon === undefined) { /* skip */ } else { patch.icon = input.icon; }
    if (input.color === undefined) { /* skip */ } else { patch.color = input.color; }
    if (input.sort === undefined) { /* skip */ } else { patch.sort = input.sort; }
    if (input.description === undefined) { /* skip */ } else { patch.description = input.description; }
    const [row] = await db.update(workflowCategories).set(patch)
      .where(buildWhere(eq(workflowCategories.id, id), tenantCondition(workflowCategories, currentUser()))).returning();
    return mapCategory(requireRow(row, '流程分类不存在'));
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    rethrowPgUniqueViolation(err, '分类编码已存在');
  }
}

export async function deleteWorkflowCategory(id: number): Promise<void> {
  await ensureCategoryExists(id);
  const used = await db.$count(workflowDefinitions, eq(workflowDefinitions.categoryId, id));
  if (used > 0) throw new HTTPException(400, { message: '该分类下仍有流程定义，无法删除' });
  await db.delete(workflowCategories)
    .where(buildWhere(eq(workflowCategories.id, id), tenantCondition(workflowCategories, currentUser())));
}
