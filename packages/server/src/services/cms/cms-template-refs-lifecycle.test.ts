import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ tables: {} as Record<string, unknown> }));
vi.mock('../../db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const rows = table === runtime.tables.cmsSites
          ? [{ settings: { defaultTemplates: { pc: { detail: 'detail-review' } } } }]
          : table === runtime.tables.cmsChannels
            ? [{
                id: 4,
                siteId: 1,
                name: 'News',
                detailTemplate: 'detail-review',
                listTemplate: null,
                settings: {},
              }]
            : [];
        const chain = {
          where: () => chain,
          limit: async () => rows,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(rows).then(resolve, reject),
        };
        return chain;
      },
    }),
    $count: vi.fn(async () => 2),
  },
}));

import { cmsChannels, cmsSites } from '../../db/schema';
import { findCmsTemplateReferences } from './cms-template-refs.service';

runtime.tables.cmsSites = cmsSites;
runtime.tables.cmsChannels = cmsChannels;

describe('CMS template deactivate reference guard', () => {
  it('keeps soft-deleted recoverable content references in lifecycle guards', async () => {
    const refs = await findCmsTemplateReferences(1, 'detail', 'detail-review');
    expect(refs).toEqual(expect.arrayContaining([
      '站点[pc]详情',
      '栏目 #4 详情',
      '2 条内容详情',
    ]));
    // 回收状态不移除显式引用；恢复无需重新选择模板，停用/切换必须继续被这些引用阻断。
    expect(refs.length).toBeGreaterThan(0);
  });
});
