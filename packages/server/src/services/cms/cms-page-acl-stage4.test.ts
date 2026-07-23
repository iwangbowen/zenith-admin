import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { CmsPageBlock } from '@zenith/shared';
import {
  assertCmsPageBlockMutationAllowed,
  cmsPageRequiresDynamic,
  filterCmsPageBlocksForStatic,
  filterCmsPageBlocksForViewer,
} from './cms-page-blocks';

const blocks: CmsPageBlock[] = [
  { id: 'public', type: 'richtext', props: { html: '<p>public</p>' }, displayCondition: { audience: 'always' } },
  { id: 'member', type: 'richtext', props: { html: '<p>member</p>' }, displayCondition: { audience: 'member' } },
  { id: 'guest', type: 'richtext', props: { html: '<p>guest</p>' }, displayCondition: { audience: 'guest' } },
];

describe('CMS Stage4 page block ACL and display security', () => {
  it('rejects forged edits, deletion and reordering of an unauthorized stable block id', () => {
    const manageable = new Set(['public']);
    expect(() => assertCmsPageBlockMutationAllowed({
      before: blocks,
      after: [blocks[0], { ...blocks[1], props: { html: '<p>forged</p>' } }, blocks[2]],
      manageableBlockIds: manageable,
      canCreate: true,
    })).toThrow(/禁止修改、删除、替换或重排/);
    expect(() => assertCmsPageBlockMutationAllowed({
      before: blocks,
      after: [blocks[2], blocks[0], blocks[1]],
      manageableBlockIds: manageable,
      canCreate: true,
    })).toThrow();

    expect(() => assertCmsPageBlockMutationAllowed({
      before: [blocks[0], blocks[1]],
      after: [blocks[1]],
      manageableBlockIds: new Set(['public']),
      canCreate: true,
    })).not.toThrow();
  });

  it('forces audience-dependent pages dynamic and never emits those blocks into static output', () => {
    expect(cmsPageRequiresDynamic(blocks)).toBe(true);
    expect(filterCmsPageBlocksForStatic(blocks).map((block) => block.id)).toEqual(['public']);
    const scheduled = [{
      id: 'scheduled',
      type: 'richtext',
      props: { html: '<p>public scheduled content</p>' },
      displayCondition: { audience: 'always', startAt: '2099-01-01 00:00:00' },
    }] as CmsPageBlock[];
    expect(cmsPageRequiresDynamic(scheduled)).toBe(true);
    expect(filterCmsPageBlocksForStatic(scheduled).map((block) => block.id)).toEqual([]);
    expect(filterCmsPageBlocksForViewer(scheduled, {
      member: false,
      now: '2026-01-01 00:00:00',
    })).toEqual([]);
    expect(filterCmsPageBlocksForViewer(blocks, { member: true }).map((block) => block.id)).toEqual(['public', 'member']);
    expect(filterCmsPageBlocksForViewer(blocks, { member: false }).map((block) => block.id)).toEqual(['public', 'guest']);
  });

  it('bypasses static/shared caches and emits private no-store responses for audience pages', async () => {
    const [frontend, staticService, blockRenderer, pagesService, aclService] = await Promise.all([
      readFile(new URL('../../routes/cms/frontend.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-static.service.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../cms/themes/blocks.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./cms-pages.service.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-page-acl.service.ts', import.meta.url), 'utf8'),
    ]);
    expect(frontend).toContain('resolveDynamicCmsPageForPath');
    expect(frontend).toContain("if (!dynamicPage && !isPreview");
    expect(frontend).toContain("'Cache-Control': 'private, no-store'");
    expect(staticService).toContain('refreshHomeStaticForChannel');
    expect(staticService).toContain('takeover?.requiresDynamic');
    expect(blockRenderer).not.toContain('data-cms-date-block');
    expect(blockRenderer).not.toContain('DATE_CONDITION_SCRIPT');
    expect(pagesService).toContain('decorateCmsPageBlocksBatch(rows)');
    expect(pagesService.indexOf('lockCmsSiteForMutation(tx, initial.siteId)'))
      .toBeLessThan(pagesService.indexOf(".for('update')", pagesService.indexOf('export async function updateCmsPage')));
    expect(aclService).toContain('.innerJoin(roles, eq(userRoles.roleId, roles.id))');
    expect(aclService).toContain("eq(roles.status, 'enabled')");
  });
});
