import { workflowDefinitions } from '../db/schema';
import { formatDateTime } from '../lib/datetime';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapDefinition(
  row: typeof workflowDefinitions.$inferSelect,
  createdByName?: string | null,
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    flowData: row.flowData,
    formFields: row.formFields,
    status: row.status,
    version: row.version,
    tenantId: row.tenantId,
    createdBy: row.createdBy,
    createdByName: createdByName ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────
import { eq, and, like, desc } from 'drizzle-orm';
import { db } from '../db';
import { pageOffset } from '../lib/pagination';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { validateFlowData } from '../lib/workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';

export async function listDefinitions(query: { page?: number; pageSize?: number; keyword?: string; status?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 20, keyword, status } = query;
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(like(workflowDefinitions.name, `%${keyword}%`));
  if (status) conditions.push(eq(workflowDefinitions.status, status as 'draft' | 'published' | 'disabled'));
  const where = conditions.length ? and(...conditions) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(workflowDefinitions, where),
    db.query.workflowDefinitions.findMany({
      where,
      with: { createdByUser: { columns: { nickname: true } } },
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
  const rows = await db.select().from(workflowDefinitions).where(and(...conditions)).orderBy(desc(workflowDefinitions.updatedAt));
  return rows.map(r => mapDefinition(r));
}

async function findDefinition(id: number) {
  const user = currentUser();
  const tc = tenantCondition(workflowDefinitions, user);
  const conds = [eq(workflowDefinitions.id, id)];
  if (tc) conds.push(tc);
  return and(...conds);
}

export async function getDefinition(id: number) {
  const where = await findDefinition(id);
  const row = await db.query.workflowDefinitions.findFirst({
    where,
    with: { createdByUser: { columns: { nickname: true } } },
  });
  if (!row) throw new AppError('流程定义不存在', 404);
  return mapDefinition(row, row.createdByUser?.nickname ?? null);
}

export async function createDefinition(data: {
  name: string; description?: string | null; flowData?: unknown; formFields?: unknown; status?: 'draft' | 'published' | 'disabled';
}) {
  const user = currentUser();
  const [row] = await db.insert(workflowDefinitions).values({
    name: data.name,
    description: data.description ?? null,
    flowData: (data.flowData as Record<string, unknown>) ?? null,
    formFields: (data.formFields ?? null) as unknown as Record<string, unknown>,
    status: data.status ?? 'draft',
    createdBy: user.userId,
    tenantId: getCreateTenantId(user),
  }).returning();
  return mapDefinition(row);
}

export async function updateDefinition(id: number, data: Partial<{
  name: string; description: string | null; flowData: unknown; formFields: unknown; status: 'draft' | 'published' | 'disabled';
}>) {
  const where = await findDefinition(id);
  const updateData: Record<string, unknown> = { ...data };
  if (data.flowData !== undefined) updateData.flowData = data.flowData as Record<string, unknown>;
  if (data.formFields !== undefined) updateData.formFields = data.formFields as unknown[];
  const [updated] = await db
    .update(workflowDefinitions)
    .set(updateData as Partial<typeof workflowDefinitions.$inferInsert>)
    .where(where)
    .returning();
  if (!updated) throw new AppError('流程定义不存在', 404);
  return mapDefinition(updated);
}

export async function publishDefinition(id: number) {
  const where = await findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new AppError('流程定义不存在', 404);
  const flowData = existing.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes) throw new AppError('请先在设计器中设计流程', 400);
  const validation = validateFlowData(flowData);
  if (!validation.valid) throw new AppError(validation.errors[0], 400);
  const [updated] = await db
    .update(workflowDefinitions)
    .set({ status: 'published', version: existing.version + 1 })
    .where(where)
    .returning();
  return mapDefinition(updated);
}

export async function disableDefinition(id: number) {
  const where = await findDefinition(id);
  const [updated] = await db.update(workflowDefinitions).set({ status: 'disabled' }).where(where).returning();
  if (!updated) throw new AppError('流程定义不存在', 404);
  return mapDefinition(updated);
}

export async function deleteDefinition(id: number) {
  const where = await findDefinition(id);
  const [existing] = await db.select().from(workflowDefinitions).where(where).limit(1);
  if (!existing) throw new AppError('流程定义不存在', 404);
  if (existing.status === 'published') throw new AppError('已发布的流程不能删除，请先禁用', 400);
  await db.delete(workflowDefinitions).where(where);
}
