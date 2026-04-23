import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { randomBytes } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { userApiTokens } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { apiResponse, ErrorResponse, jsonContent, MessageResponse, validationHook, commonErrorResponses } from '../lib/openapi-schemas';
import { ApiTokenListItemDTO as TokenListItem, ApiTokenCreatedDTO as TokenCreated } from '../lib/openapi-dtos';

const apiTokensRoute = new OpenAPIHono({ defaultHook: validationHook });

// ─── Schemas ───────────────────────────────────────────────────────────────
const CreateTokenBody = z.object({
  name: z.string(),
  expiresAt: z.string().optional(),
});

// ─── Routes ────────────────────────────────────────────────────────────────
const list = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['ApiTokens'],
    summary: '获取我的 API Token 列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(z.array(TokenListItem))), description: 'Token 列表' },
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const rows = await db
      .select()
      .from(userApiTokens)
      .where(eq(userApiTokens.userId, payload.userId))
      .orderBy(desc(userApiTokens.createdAt));

    return c.json(
      {
        code: 0 as const,
        message: 'ok',
        data: rows.map((r) => ({
          id: r.id,
          name: r.name,
          tokenPrefix: `${r.token.slice(0, 12)}...`,
          lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      200,
    );
  },
});

const create = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/',
    tags: ['ApiTokens'],
    summary: '创建 API Token（完整 token 仅返回一次）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      body: { content: jsonContent(CreateTokenBody), required: true },
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(apiResponse(TokenCreated)), description: '创建成功' },
      400: { content: jsonContent(ErrorResponse), description: '参数错误或数量超限' },
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const body = c.req.valid('json');

    if (!body.name?.trim()) {
      return c.json({ code: 400, message: 'Token 名称不能为空', data: null }, 400);
    }

    const existingCount = await db.$count(userApiTokens, eq(userApiTokens.userId, payload.userId));
    if (existingCount >= 20) {
      return c.json({ code: 400, message: '最多只能创建 20 个 API Token', data: null }, 400);
    }

    const token = `zat_${randomBytes(24).toString('hex')}`;
    const [row] = await db
      .insert(userApiTokens)
      .values({
        userId: payload.userId,
        name: body.name.trim(),
        token,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      })
      .returning();

    return c.json(
      {
        code: 0 as const,
        message: 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token',
        data: {
          id: row.id,
          name: row.name,
          token,
          createdAt: row.createdAt.toISOString(),
        },
      },
      200,
    );
  },
});

const deleteToken = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['ApiTokens'],
    summary: '撤销 API Token',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: {
      params: z.object({ id: z.coerce.number() }),
    },
    responses: {
      ...commonErrorResponses,
      200: { content: jsonContent(MessageResponse), description: 'Token 已撤销' },
      400: { content: jsonContent(ErrorResponse), description: '无效 ID' },
      404: { content: jsonContent(ErrorResponse), description: 'Token 不存在' },
    },
  }),
  handler: async (c) => {
    const payload = c.get('user');
    const { id } = c.req.valid('param');
    if (Number.isNaN(id)) {
      return c.json({ code: 400, message: '无效的 Token ID', data: null }, 400);
    }

    const result = await db
      .delete(userApiTokens)
      .where(and(eq(userApiTokens.id, id), eq(userApiTokens.userId, payload.userId)))
      .returning();

    if (result.length === 0) {
      return c.json({ code: 404, message: 'Token 不存在', data: null }, 404);
    }
    return c.json({ code: 0 as const, message: 'Token 已撤销', data: null }, 200);
  },
});

apiTokensRoute.openapiRoutes([list, create, deleteToken] as const);

export default apiTokensRoute;
