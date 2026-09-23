import { describe, expect, it } from 'vitest';
import type { DbExecutor } from '../../db/types';
import { cmsPages, cmsWidgets, cmsChannels, cmsTags, cmsWidgetRefs, cmsContents } from '../../db/schema';
import { assertCmsReleaseDependencies } from './cms-release-preflight.service';

function executor(overrides: Array<[unknown, unknown[]]>) {
  const data = new Map<unknown, unknown[]>([[cmsPages, []], [cmsWidgets, []], [cmsChannels, []], [cmsTags, []], [cmsWidgetRefs, []], [cmsContents, []], ...overrides]);
  return { select: () => ({ from: (table: unknown) => ({ where: async () => data.get(table) ?? [] }) }) } as unknown as DbExecutor;
}
describe('CMS candidate dependency checks', () => {
  it('blocks a selected page when its widget was not included in the candidate', async () => {
    const tx = executor([[cmsPages, [{ id: 1, name: 'Home', blocks: [{ id: 'recommendations', type: 'widget-ref', props: { widgetId: 9 } }] }]]]);
    await expect(assertCmsReleaseDependencies(tx, 2)).rejects.toThrow('请将依赖一并加入发布单');
  });
  it('checks widget content against the candidate public set', async () => {
    const tx = executor([
      [cmsChannels, [{ id: 3, parentId: 0, status: 'enabled' }]],
      [cmsWidgets, [{ id: 9, name: 'Recommendations', status: 'published', publishedData: { items: [{ id: 'entry', sourceType: 'content', sourceId: 7 }] } }]],
      [cmsContents, [{ id: 7, channelId: 3, status: 'draft', deletedAt: null, archivedAt: null, expireAt: null }]],
    ]);
    await expect(assertCmsReleaseDependencies(tx, 2)).rejects.toThrow('不在候选公开集合中');
  });
});
