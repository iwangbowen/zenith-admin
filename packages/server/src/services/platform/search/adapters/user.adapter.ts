import { eq, ilike, or } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { departments, users } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const userSearchAdapter: GlobalSearchAdapter = {
  type: 'user',
  permissions: ['system:user:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:user:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: users.id });
    const rows = await db.select({
      id: users.id,
      username: users.username,
      nickname: users.nickname,
      departmentName: departments.name,
      status: users.status,
    })
      .from(users)
      .leftJoin(departments, eq(users.departmentId, departments.id))
      .where(buildWhere(
        or(ilike(users.username, pattern), ilike(users.nickname, pattern))!,
        scope,
        tenantCondition(users, user),
      ))
      .orderBy(users.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'user',
      id: String(row.id),
      title: row.nickname,
      subtitle: [row.username, row.departmentName].filter(Boolean).join(' · '),
      description: row.status === 'enabled' ? '启用' : '停用',
      icon: 'UsersRound',
      route: `/system/users?keyword=${encodeURIComponent(row.username)}`,
      highlights: [{ field: 'title', text: row.nickname }],
    }));
  },
};
