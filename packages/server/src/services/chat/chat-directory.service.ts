import { eq, ne, asc } from 'drizzle-orm';
import { db } from '../../db';
import { departments, users } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { keywordCondition, buildWhere } from '../../lib/where-helpers';
import { exactTenantCondition } from '../../lib/tenant';

// ─── 获取可聊天的用户列表 ──────────────────────────────────────────────────────

export async function listChatUsers(keyword?: string) {
  const me = currentUser();

  const rows = await db
    .select({ id: users.id, nickname: users.nickname, avatar: users.avatar, username: users.username })
    .from(users)
    .where(buildWhere(
      ne(users.id, me.userId),
      eq(users.status, 'enabled'),
      exactTenantCondition(users.tenantId, me.tenantId),
      keywordCondition(keyword, [users.nickname, users.username], 'ilike'),
    ))
    .limit(50);

  return rows;
}

// ─── 组织架构选人数据 ─────────────────────────────────────────────────────────

export async function getChatOrgData() {
  const me = currentUser();

  const [deptRows, userRows] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, parentId: departments.parentId })
      .from(departments)
      .where(buildWhere(
        eq(departments.status, 'enabled'),
        exactTenantCondition(departments.tenantId, me.tenantId),
      ))
      .orderBy(asc(departments.sort), asc(departments.id)),
    db
      .select({
        id: users.id, nickname: users.nickname, username: users.username,
        avatar: users.avatar, departmentId: users.departmentId,
      })
      .from(users)
      .where(buildWhere(
        ne(users.id, me.userId),
        eq(users.status, 'enabled'),
        exactTenantCondition(users.tenantId, me.tenantId),
      ))
      .orderBy(asc(users.id)),
  ]);

  return { departments: deptRows, users: userRows };
}
