import { Hono } from 'hono';
import { eq, and, like, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { workflowDefinitions, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { createWorkflowDefinitionSchema, updateWorkflowDefinitionSchema } from '@zenith/shared';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { validateFlowData } from '../lib/workflow-engine';
import type { JwtPayload } from '../middleware/auth';
import type { WorkflowFlowData } from '@zenith/shared';

type Env = { Variables: { user: JwtPayload } };
const router = new Hono<Env>();
router.use('*', authMiddleware);

function toDefinition(row: typeof workflowDefinitions.$inferSelect, createdByName?: string | null) {
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET / — 列表（分页 + 搜索）
router.get('/', guard({ permission: 'workflow:definition:list' }), async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Number(c.req.query('pageSize') ?? 20);
  const keyword = c.req.query('keyword') ?? '';
  const status = c.req.query('status');

  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(like(workflowDefinitions.name, `%${keyword}%`));
  if (status) conditions.push(eq(workflowDefinitions.status, status as 'draft' | 'published' | 'disabled'));

  const where = conditions.length ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(workflowDefinitions)
    .where(where);

  const rows = await db
    .select({
      def: workflowDefinitions,
      createdByName: users.nickname,
    })
    .from(workflowDefinitions)
    .leftJoin(users, eq(workflowDefinitions.createdBy, users.id))
    .where(where)
    .orderBy(desc(workflowDefinitions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map(r => toDefinition(r.def, r.createdByName)),
      total,
      page,
      pageSize,
    },
  });
});

// GET /published — 已发布列表（发起流程时选择）
router.get('/published', guard({ permission: 'workflow:instance:create' }), async (c) => {
  const user = c.get('user');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.status, 'published')];
  if (tc) conditions.push(tc);

  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(and(...conditions))
    .orderBy(desc(workflowDefinitions.updatedAt));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map(r => toDefinition(r)),
  });
});

// GET /:id — 详情
router.get('/:id', guard({ permission: 'workflow:definition:list' }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);

  const rows = await db
    .select({ def: workflowDefinitions, createdByName: users.nickname })
    .from(workflowDefinitions)
    .leftJoin(users, eq(workflowDefinitions.createdBy, users.id))
    .where(and(...conditions))
    .limit(1);

  if (!rows.length) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  return c.json({ code: 0, message: 'ok', data: toDefinition(rows[0].def, rows[0].createdByName) });
});

// POST / — 创建
router.post('/', guard({ permission: 'workflow:definition:create', audit: { description: '创建流程定义', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const result = createWorkflowDefinitionSchema.safeParse(body);
  if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

  const [row] = await db.insert(workflowDefinitions).values({
    ...result.data,
    flowData: result.data.flowData as Record<string, unknown> ?? null,
    formFields: (result.data.formFields ?? null) as unknown as Record<string, unknown>,
    createdBy: user.userId,
    tenantId: getCreateTenantId(user),
  }).returning();

  return c.json({ code: 0, message: '创建成功', data: toDefinition(row) });
});

// PUT /:id — 更新
router.put('/:id', guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程定义', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateWorkflowDefinitionSchema.safeParse(body);
  if (!result.success) return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);

  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);

  const updateData: Record<string, unknown> = {
    ...result.data,
    updatedAt: new Date(),
  };
  if (result.data.flowData !== undefined) updateData.flowData = result.data.flowData as Record<string, unknown>;
  if (result.data.formFields !== undefined) updateData.formFields = result.data.formFields as unknown[];

  const [updated] = await db
    .update(workflowDefinitions)
    .set(updateData as Partial<typeof workflowDefinitions.$inferInsert>)
    .where(and(...conditions))
    .returning();

  if (!updated) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  return c.json({ code: 0, message: '更新成功', data: toDefinition(updated) });
});

// POST /:id/publish — 发布
router.post('/:id/publish', guard({ permission: 'workflow:definition:publish', audit: { description: '发布流程定义', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);

  const [existing] = await db.select().from(workflowDefinitions).where(and(...conditions)).limit(1);
  if (!existing) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);

  // 使用引擎校验流程图
  const flowData = existing.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes) return c.json({ code: 400, message: '请先在设计器中设计流程', data: null }, 400);
  const validation = validateFlowData(flowData);
  if (!validation.valid) return c.json({ code: 400, message: validation.errors[0], data: null }, 400);

  const [updated] = await db
    .update(workflowDefinitions)
    .set({ status: 'published', version: existing.version + 1, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  return c.json({ code: 0, message: '发布成功', data: toDefinition(updated) });
});

// POST /:id/disable — 禁用
router.post('/:id/disable', guard({ permission: 'workflow:definition:publish', audit: { description: '禁用流程定义', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);

  const [updated] = await db
    .update(workflowDefinitions)
    .set({ status: 'disabled', updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!updated) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  return c.json({ code: 0, message: '禁用成功', data: toDefinition(updated) });
});

// DELETE /:id — 删除（仅 draft 状态）
router.delete('/:id', guard({ permission: 'workflow:definition:delete', audit: { description: '删除流程定义', module: '工作流管理' } }), async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);

  const [existing] = await db.select().from(workflowDefinitions).where(and(...conditions)).limit(1);
  if (!existing) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  if (existing.status === 'published') return c.json({ code: 400, message: '已发布的流程不能删除，请先禁用', data: null }, 400);

  await db.delete(workflowDefinitions).where(and(...conditions));
  return c.json({ code: 0, message: '删除成功', data: null });
});

export default router;
