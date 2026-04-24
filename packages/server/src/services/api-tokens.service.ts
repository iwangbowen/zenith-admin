import { randomBytes } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { userApiTokens } from '../db/schema';
import { currentUser } from '../lib/context';
import { AppError } from '../lib/errors';

export async function listApiTokens() {
  const user = currentUser();
  const rows = await db.select().from(userApiTokens).where(eq(userApiTokens.userId, user.userId)).orderBy(desc(userApiTokens.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: `${r.token.slice(0, 12)}...`,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createApiToken(input: { name: string; expiresAt?: string }) {
  const user = currentUser();
  if (!input.name?.trim()) throw new AppError('Token 名称不能为空', 400);
  const existingCount = await db.$count(userApiTokens, eq(userApiTokens.userId, user.userId));
  if (existingCount >= 20) throw new AppError('最多只能创建 20 个 API Token', 400);
  const token = `zat_${randomBytes(24).toString('hex')}`;
  const [row] = await db.insert(userApiTokens).values({
    userId: user.userId,
    name: input.name.trim(),
    token,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
  }).returning();
  return { id: row.id, name: row.name, token, createdAt: row.createdAt.toISOString() };
}

export async function deleteApiToken(id: number) {
  const user = currentUser();
  if (Number.isNaN(id)) throw new AppError('无效的 Token ID', 400);
  const result = await db.delete(userApiTokens).where(and(eq(userApiTokens.id, id), eq(userApiTokens.userId, user.userId))).returning();
  if (result.length === 0) throw new AppError('Token 不存在', 404);
}
