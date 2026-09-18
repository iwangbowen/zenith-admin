import { eq, desc } from 'drizzle-orm';
import { hasPermission } from '../../../../lib/context';
import { db } from '../../../../db';
import { cmsChannels, cmsContents, cmsSites } from '../../../../db/schema';
import { getAccessibleSiteIds } from '../../../cms/cms-sites.service';
import { buildCmsContentListWhere } from '../../../cms/cms-contents-query.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const cmsContentSearchAdapter: GlobalSearchAdapter = {
  type: 'cms-content',
  permissions: ['cms:content:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('cms:content:list'))) return [];
    // getAccessibleSiteIds 复用 CMS 站点 ACL；平台管理员再读取启用站点清单。
    const accessible = await getAccessibleSiteIds();
    const siteIds = accessible ?? (await db.select({ id: cmsSites.id }).from(cmsSites).where(eq(cmsSites.status, 'enabled'))).map((row) => row.id);
    if (siteIds.length === 0) return [];
    const pages = await Promise.all(siteIds.map(async (siteId) => {
      const where = await buildCmsContentListWhere({ siteId, keyword: q, page: 1, pageSize: limit, deleted: false, archived: false });
      return db.select({
        id: cmsContents.id,
        siteId: cmsContents.siteId,
        title: cmsContents.title,
        author: cmsContents.author,
        status: cmsContents.status,
        contentType: cmsContents.contentType,
        channelName: cmsChannels.name,
        siteName: cmsSites.name,
      })
        .from(cmsContents)
        .innerJoin(cmsChannels, eq(cmsContents.channelId, cmsChannels.id))
        .innerJoin(cmsSites, eq(cmsContents.siteId, cmsSites.id))
        .where(where)
        .orderBy(desc(cmsContents.isTop), desc(cmsContents.topWeight), desc(cmsContents.id))
        .limit(limit);
    }));
    return pages.flat().slice(0, limit).map((content) => result({
      type: 'cms-content',
      id: String(content.id),
      title: content.title,
      subtitle: [content.siteName, content.channelName, content.contentType].filter(Boolean).join(' · '),
      description: [content.status, content.author].filter(Boolean).join(' · '),
      icon: 'FileText',
      route: `/cms/contents/edit?id=${content.id}&siteId=${content.siteId}`,
      highlights: [{ field: 'title', text: content.title }],
    }));
  },
};
