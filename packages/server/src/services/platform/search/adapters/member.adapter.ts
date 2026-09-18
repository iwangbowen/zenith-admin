import { eq, ilike, isNull, or } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { members, memberLevels } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const memberSearchAdapter: GlobalSearchAdapter = {
  type: 'member',
  permissions: ['member:member:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('member:member:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const scope = await getDataScopeCondition({ currentUserId: user.userId, ownerColumn: members.createdBy });
    const rows = await db.select({
      id: members.id,
      nickname: members.nickname,
      username: members.username,
      levelName: memberLevels.name,
      status: members.status,
    })
      .from(members)
      .leftJoin(memberLevels, eq(members.levelId, memberLevels.id))
      .where(buildWhere(
        isNull(members.deletedAt),
        or(ilike(members.nickname, pattern), ilike(members.username, pattern), ilike(members.phone, pattern), ilike(members.email, pattern))!,
        scope,
        tenantCondition(members, user),
      ))
      .orderBy(members.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'member',
      id: String(row.id),
      title: row.nickname,
      subtitle: [row.username, row.levelName].filter(Boolean).join(' · '),
      description: row.status === 'active' ? '正常' : row.status === 'banned' ? '已封禁' : '停用',
      icon: 'UserRound',
      route: `/member/members?keyword=${encodeURIComponent(row.nickname)}`,
      highlights: [{ field: 'title', text: row.nickname }],
    }));
  },
};
