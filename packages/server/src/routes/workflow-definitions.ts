import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { eq, and, like, desc, sql } from 'drizzle-orm';
import { db } from '../db';
import { workflowDefinitions, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { validateFlowData } from '../lib/workflow-engine';
import type { JwtPayload } from '../middleware/auth';
import type { WorkflowFlowData } from '@zenith/shared';
import { apiResponse, ErrorResponse, MessageResponse, PaginationQuery, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

type Env = { Variables: { user: JwtPayload } };
const router = new OpenAPIHono<Env>({ defaultHook: validationHook });
router.use('*', authMiddleware);

const WorkflowDefinitionDTO = z.looseObject({}).openapi('WorkflowDefinition');

const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  formFields: z.array(z.looseObject({})).nullable().optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
});
const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial();

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

// GET /
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['WorkflowDefinitions'],
  summary: '流程定义列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:list' })] as const,
  request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(paginatedResponse(WorkflowDefinitionDTO)), description: 'ok' },
  },
});
router.openapi(listRoute, async (c) => {
  const user = c.get('user');
  const { page = 1, pageSize = 20, keyword, status } = c.req.valid('query');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [];
  if (tc) conditions.push(tc);
  if (keyword) conditions.push(like(workflowDefinitions.name, `%${keyword}%`));
  if (status) conditions.push(eq(workflowDefinitions.status, status as 'draft' | 'published' | 'disabled'));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(workflowDefinitions).where(where);
  const rows = await db
    .select({ def: workflowDefinitions, createdByName: users.nickname })
    .from(workflowDefinitions)
    .leftJoin(users, eq(workflowDefinitions.createdBy, users.id))
    .where(where)
    .orderBy(desc(workflowDefinitions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return c.json({ code: 0 as const, message: 'ok', data: { list: rows.map(r => toDefinition(r.def, r.createdByName)), total, page, pageSize } }, 200);
});

// GET /published
const publishedRoute = createRoute({
  method: 'get',
  path: '/published',
  tags: ['WorkflowDefinitions'],
  summary: '已发布列表',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:instance:create' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(WorkflowDefinitionDTO))), description: 'ok' },
  },
});
router.openapi(publishedRoute, async (c) => {
  const user = c.get('user');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.status, 'published')];
  if (tc) conditions.push(tc);
  const rows = await db.select().from(workflowDefinitions).where(and(...conditions)).orderBy(desc(workflowDefinitions.updatedAt));
  return c.json({ code: 0 as const, message: 'ok', data: rows.map(r => toDefinition(r)) }, 200);
});

// GET /{id}
const detailRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['WorkflowDefinitions'],
  summary: '流程定义详情',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(WorkflowDefinitionDTO)), description: 'ok' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
router.openapi(detailRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
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
  return c.json({ code: 0 as const, message: 'ok', data: toDefinition(rows[0].def, rows[0].createdByName) }, 200);
});

// POST /
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['WorkflowDefinitions'],
  summary: '创建流程定义',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:create', audit: { description: '创建流程定义', module: '工作流管理' } })] as const,
  request: { body: { content: jsonContent(createWorkflowDefinitionSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(WorkflowDefinitionDTO)), description: '创建成功' },
  },
});
router.openapi(createRouteDef, async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const [row] = await db.insert(workflowDefinitions).values({
    ...data,
    flowData: (data.flowData as Record<string, unknown>) ?? null,
    formFields: (data.formFields ?? null) as unknown as Record<string, unknown>,
    createdBy: user.userId,
    tenantId: getCreateTenantId(user),
  }).returning();
  return c.json({ code: 0 as const, message: '创建成功', data: toDefinition(row) }, 200);
});

// PUT /{id}
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['WorkflowDefinitions'],
  summary: '更新流程定义',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程定义', module: '工作流管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }), body: { content: jsonContent(updateWorkflowDefinitionSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(WorkflowDefinitionDTO)), description: '更新成功' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
router.openapi(updateRouteDef, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);
  const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
  if (data.flowData !== undefined) updateData.flowData = data.flowData as Record<string, unknown>;
  if (data.formFields !== undefined) updateData.formFields = data.formFields as unknown[];
  const [updated] = await db
    .update(workflowDefinitions)
    .set(updateData as Partial<typeof workflowDefinitions.$inferInsert>)
    .where(and(...conditions))
    .returning();
  if (!updated) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '更新成功', data: toDefinition(updated) }, 200);
});

// POST /{id}/publish
const publishRoute = createRoute({
  method: 'post',
  path: '/{id}/publish',
  tags: ['WorkflowDefinitions'],
  summary: '发布流程',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:publish', audit: { description: '发布流程定义', module: '工作流管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(WorkflowDefinitionDTO)), description: '发布成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
router.openapi(publishRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);
  const [existing] = await db.select().from(workflowDefinitions).where(and(...conditions)).limit(1);
  if (!existing) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  const flowData = existing.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes) return c.json({ code: 400, message: '请先在设计器中设计流程', data: null }, 400);
  const validation = validateFlowData(flowData);
  if (!validation.valid) return c.json({ code: 400, message: validation.errors[0], data: null }, 400);
  const [updated] = await db
    .update(workflowDefinitions)
    .set({ status: 'published', version: existing.version + 1, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  return c.json({ code: 0 as const, message: '发布成功', data: toDefinition(updated) }, 200);
});

// POST /{id}/disable
const disableRoute = createRoute({
  method: 'post',
  path: '/{id}/disable',
  tags: ['WorkflowDefinitions'],
  summary: '禁用流程',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:publish', audit: { description: '禁用流程定义', module: '工作流管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(WorkflowDefinitionDTO)), description: 'ok' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
router.openapi(disableRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);
  const [updated] = await db.update(workflowDefinitions).set({ status: 'disabled', updatedAt: new Date() }).where(and(...conditions)).returning();
  if (!updated) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '禁用成功', data: toDefinition(updated) }, 200);
});

// DELETE /{id}
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['WorkflowDefinitions'],
  summary: '删除流程',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'workflow:definition:delete', audit: { description: '删除流程定义', module: '工作流管理' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
router.openapi(deleteRouteDef, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const tc = tenantCondition(workflowDefinitions, user);
  const conditions = [eq(workflowDefinitions.id, id)];
  if (tc) conditions.push(tc);
  const [existing] = await db.select().from(workflowDefinitions).where(and(...conditions)).limit(1);
  if (!existing) return c.json({ code: 404, message: '流程定义不存在', data: null }, 404);
  if (existing.status === 'published') return c.json({ code: 400, message: '已发布的流程不能删除，请先禁用', data: null }, 400);
  await db.delete(workflowDefinitions).where(and(...conditions));
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

export default router;
