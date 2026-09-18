import { hasPermission } from '../../../../lib/context';
import { searchWikiDocs } from '../../../wiki/docs.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const wikiDocumentSearchAdapter: GlobalSearchAdapter = {
  type: 'wiki-document',
  permissions: ['wiki:doc:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('wiki:doc:list'))) return [];
    const page = await searchWikiDocs({ page: 1, pageSize: limit, keyword: q }, { recordSearchLog: false, includeSnippet: false });
    return page.list.map((doc) => result({
      type: 'wiki-document',
      id: String(doc.id),
      title: doc.title,
      subtitle: [doc.spaceName, doc.status].filter(Boolean).join(' · '),
      description: doc.summary ?? undefined,
      icon: 'BookOpenText',
      route: `/wiki/docs?docId=${doc.id}`,
      // 正文 snippet 不进入统一搜索摘要，避免列表权限下暴露正文片段。
      highlights: [{ field: 'title', text: doc.title }],
    }));
  },
};
