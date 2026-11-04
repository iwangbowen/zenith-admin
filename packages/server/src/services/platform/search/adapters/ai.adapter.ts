import { hasPermission } from '../../../../lib/context';
import { listKnowledgeBases } from '../../../ai/ai-knowledge.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

export const aiKnowledgeBaseSearchAdapter: GlobalSearchAdapter = {
  type: 'ai-knowledge-base',
  permissions: ['ai:kb:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('ai:kb:list'))) return [];
    const rows = (await listKnowledgeBases()).filter((kb) => kb.name.toLowerCase().includes(q.toLowerCase())).slice(0, limit);
    return rows.map((kb) => result({
      type: 'ai-knowledge-base',
      id: String(kb.id),
      title: kb.name,
      subtitle: `${kb.documentCount} 篇文档 · ${kb.chunkCount} 个分块`,
      description: kb.description,
      icon: 'Library',
      route: `/ai/knowledge?kbId=${kb.id}`,
      highlights: [{ field: 'title', text: kb.name }],
    }));
  },
};
