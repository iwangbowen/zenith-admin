import { ilike } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { announcements } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const announcementSearchAdapter: GlobalSearchAdapter = {
  type: 'announcement',
  permissions: ['system:announcement:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('system:announcement:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const rows = await db.select({
      id: announcements.id,
      title: announcements.title,
      type: announcements.type,
      publishStatus: announcements.publishStatus,
      priority: announcements.priority,
      publishTime: announcements.publishTime,
    })
      .from(announcements)
      .where(buildWhere(ilike(announcements.title, pattern), tenantCondition(announcements, user)))
      .orderBy(announcements.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'announcement',
      id: String(row.id),
      title: row.title,
      subtitle: [row.type, row.priority].filter(Boolean).join(' · '),
      description: [row.publishStatus, row.publishTime?.toISOString().slice(0, 10)].filter(Boolean).join(' · '),
      icon: 'Megaphone',
      route: `/system/announcements?title=${encodeURIComponent(row.title)}`,
      highlights: [{ field: 'title', text: row.title }],
    }));
  },
};

