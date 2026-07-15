import { createHash, randomBytes } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { userApiTokens } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { HTTPException } from 'hono/http-exception';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../../lib/datetime';

export async function listApiTokens() {
  const user = currentUser();
  const rows = await db.select().from(userApiTokens).where(eq(userApiTokens.userId, user.userId)).orderBy(desc(userApiTokens.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    tokenPrefix: r.tokenPrefix ?? '已失效（旧版）',
    lastUsedAt: formatNullableDateTime(r.lastUsedAt),
    expiresAt: formatNullableDateTime(r.expiresAt),
    createdAt: formatDateTime(r.createdAt),
  }));
}

export async function createApiToken(input: { name: string; expiresAt?: string }) {
  const user = currentUser();
  if (!input.name?.trim()) throw new HTTPException(400, { message: 'Token 名称不能为空' });
  const existingCount = await db.$count(userApiTokens, eq(userApiTokens.userId, user.userId));
  if (existingCount >= 20) throw new HTTPException(400, { message: '最多只能创建 20 个 API Token' });
  const token = `zat_${randomBytes(24).toString('hex')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [row] = await db.insert(userApiTokens).values({
    userId: user.userId,
    name: input.name.trim(),
    tokenHash,
    tokenPrefix: `${token.slice(0, 12)}...`,
    expiresAt: parseDateTimeInput(input.expiresAt),
  }).returning();
  return { id: row.id, name: row.name, token, createdAt: formatDateTime(row.createdAt) };
}

export async function deleteApiToken(id: number) {
  const user = currentUser();
  if (Number.isNaN(id)) throw new HTTPException(400, { message: '无效的 Token ID' });
  const result = await db.delete(userApiTokens).where(and(eq(userApiTokens.id, id), eq(userApiTokens.userId, user.userId))).returning();
  if (result.length === 0) throw new HTTPException(404, { message: 'Token 不存在' });
}
