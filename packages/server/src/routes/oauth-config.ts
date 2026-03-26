import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { oauthConfigs } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { updateOauthConfigSchema } from '@zenith/shared';
import type { JwtPayload } from '../middleware/auth';
import type { OAuthProviderType } from '@zenith/shared';

const VALID_PROVIDERS: OAuthProviderType[] = ['github', 'dingtalk', 'wechat_work'];

const oauthConfigRouter = new Hono<{ Variables: { user: JwtPayload } }>();
oauthConfigRouter.use('*', authMiddleware);

// GET / — 获取所有 OAuth 配置（mask secret）
oauthConfigRouter.get('/', guard({ permission: 'system:oauth-config:view' }), async (c) => {
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
  return c.json({ code: 0, message: 'success', data: safeConfigs });
});

// PUT /:provider — 更新指定 provider 的配置
oauthConfigRouter.put(
  '/:provider',
  guard({ permission: 'system:oauth-config:update', audit: { description: '更新OAuth配置', module: 'OAuth配置' } }),
  async (c) => {
    const provider = c.req.param('provider') as OAuthProviderType;
    if (!VALID_PROVIDERS.includes(provider)) {
      return c.json({ code: 400, message: '不支持的提供方', data: null }, 400);
    }

    const body = await c.req.json();
    const result = updateOauthConfigSchema.safeParse(body);
    if (!result.success) {
      return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
    }

    // 如果 clientSecret 是 mask 值则不更新
    const updateData: Record<string, unknown> = {
      clientId: result.data.clientId,
      enabled: result.data.enabled,
      agentId: result.data.agentId ?? null,
      corpId: result.data.corpId ?? null,
      updatedAt: new Date(),
    };
    if (result.data.clientSecret && result.data.clientSecret !== '******') {
      updateData.clientSecret = result.data.clientSecret;
    }

    const [existing] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, provider)).limit(1);
    if (!existing) {
      const [created] = await db
        .insert(oauthConfigs)
        .values({ provider, ...updateData } as typeof oauthConfigs.$inferInsert)
        .returning();
      return c.json({ code: 0, message: '保存成功', data: created });
    }

    const [updated] = await db
      .update(oauthConfigs)
      .set(updateData)
      .where(eq(oauthConfigs.provider, provider))
      .returning();
    return c.json({ code: 0, message: '保存成功', data: updated });
  },
);

export default oauthConfigRouter;
