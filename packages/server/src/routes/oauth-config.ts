import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { oauthConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import type { OAuthProviderType } from '@zenith/shared';
import { ErrorResponse, jsonContent, validationHook, commonErrorResponses, ok } from '../lib/openapi-schemas';

import { OAuthConfigItemDTO as OAuthConfigItem } from '../lib/openapi-dtos';

import { updateOauthConfigSchema } from '@zenith/shared';

const VALID_PROVIDERS: OAuthProviderType[] = ['github', 'dingtalk', 'wechat_work'];

const oauthConfigRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── Routes ────────────────────────────────────────────────────────────────────────────
const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['OAuthConfig'],
    summary: '获取所有 OAuth 配置',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:oauth-config:view' })] as const,
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(OAuthConfigItem), 'OAuth 配置列表'),
    },
  }),
  handler: async (c) => {
    // 确保三个 provider 都有记录
    for (const p of VALID_PROVIDERS) {
      const [existing] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, p)).limit(1);
      if (!existing) {
        await db.insert(oauthConfigs).values({ provider: p }).onConflictDoNothing();
      }
    }

    const configs = await db.select().from(oauthConfigs);
    const safeConfigs = configs.map(({ clientSecret, ...rest }) => ({
      ...rest,
      clientSecret: clientSecret ? '******' : '',
    }));
    return c.json({ code: 0 as const, message: 'success', data: safeConfigs }, 200);
  },
});

const updateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put',
    path: '/{provider}',
    tags: ['OAuthConfig'],
    summary: '更新指定 provider 的 OAuth 配置',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({
        permission: 'system:oauth-config:update',
        audit: { description: '更新OAuth配置', module: 'OAuth配置' },
      }),
    ] as const,
    request: {
      params: z.object({ provider: z.string().openapi({ param: { name: 'provider', in: 'path' }, example: 'github', description: 'OAuth 提供方' }) }),
      body: {
        content: jsonContent(updateOauthConfigSchema),
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(OAuthConfigItem.nullable(), '保存成功'),
      400: { content: jsonContent(ErrorResponse), description: '不支持的 provider' },
    },
  }),
  handler: async (c) => {
    const provider = c.req.param('provider') as OAuthProviderType;
    if (!VALID_PROVIDERS.includes(provider)) {
      return c.json({ code: 400, message: '不支持的提供方', data: null }, 400);
    }

    const data = c.req.valid('json');

    const updateData: Record<string, unknown> = {
      clientId: data.clientId,
      enabled: data.enabled,
      agentId: data.agentId ?? null,
      corpId: data.corpId ?? null,
    };
    if (data.clientSecret && data.clientSecret !== '******') {
      updateData.clientSecret = data.clientSecret;
    }

    const [existing] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, provider)).limit(1);
    if (!existing) {
      const [created] = await db
        .insert(oauthConfigs)
        .values({ provider, ...updateData } as typeof oauthConfigs.$inferInsert)
        .returning();
      return c.json({ code: 0 as const, message: '保存成功', data: created }, 200);
    }

    const [updated] = await db
      .update(oauthConfigs)
      .set(updateData)
      .where(eq(oauthConfigs.provider, provider))
      .returning();
    return c.json({ code: 0 as const, message: '保存成功', data: updated }, 200);
  },
});

oauthConfigRouter.openapiRoutes([listRoute, updateRoute] as const);

export default oauthConfigRouter;
