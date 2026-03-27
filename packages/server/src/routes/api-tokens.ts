import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { userApiTokens } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import type { JwtPayload } from '../middleware/auth';

const apiTokensRoute = new Hono();
apiTokensRoute.use('/*', authMiddleware);

function getUser(c: { get: (key: 'user') => unknown }): JwtPayload {
  return c.get('user') as JwtPayload;
}

// 获取我的 API Token 列表（不返回完整 token，仅返回前缀）
apiTokensRoute.get('/', async (c) => {
  const payload = getUser(c as { get: (key: 'user') => unknown });
  const rows = await db
    .select()
    .from(userApiTokens)
    .where(eq(userApiTokens.userId, payload.userId))
    .orderBy(desc(userApiTokens.createdAt));

  return c.json({
    code: 0,
    message: 'ok',
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      tokenPrefix: `${r.token.slice(0, 12)}...`,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// 创建 API Token（完整 token 仅在此刻返回一次）
apiTokensRoute.post('/', async (c) => {
  const payload = getUser(c as { get: (key: 'user') => unknown });
  const body = await c.req.json<{ name: string; expiresAt?: string }>();

  if (!body.name?.trim()) {
    return c.json({ code: 400, message: 'Token 名称不能为空', data: null }, 400);
  }

  // Count existing tokens per user (max 20)
  const existing = await db
    .select({ id: userApiTokens.id })
    .from(userApiTokens)
    .where(eq(userApiTokens.userId, payload.userId));
  if (existing.length >= 20) {
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

  return c.json({
    code: 0,
    message: 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token',
    data: {
      id: row.id,
      name: row.name,
      token, // 完整 token 仅返回一次
      createdAt: row.createdAt.toISOString(),
    },
  });
});

// 撤销（删除）指定 Token
apiTokensRoute.delete('/:id', async (c) => {
  const payload = getUser(c as { get: (key: 'user') => unknown });
  const id = Number(c.req.param('id'));
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
  return c.json({ code: 0, message: 'Token 已撤销', data: null });
});

export default apiTokensRoute;
