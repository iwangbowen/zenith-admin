import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ tables: {} as Record<string, unknown> }));
vi.mock('../../db', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => table === runtime.tables.cmsSites
            ? [{ id: 1, code: 'purge-snapshot-test', staticMode: 'hybrid' }]
            : [],
        }),
      }),
    }),
  },
}));
vi.mock('./cms-publish-artifact-tracker', () => ({ recordCmsPublishArtifact: vi.fn(async () => undefined) }));
vi.mock('./cms-site-inheritance.service', () => ({
  resolveEffectiveCmsSiteRow: vi.fn(async () => ({
    id: 1,
    code: 'purge-snapshot-test',
    staticMode: 'hybrid',
    settings: {},
  })),
}));

import { cmsContents, cmsSites } from '../../db/schema';
import { applyCmsContentPublishSnapshot, resolveStaticFile, siteStaticDir } from './cms-static.service';

runtime.tables.cmsSites = cmsSites;
runtime.tables.cmsContents = cmsContents;

afterEach(async () => {
  await fs.rm(siteStaticDir('purge-snapshot-test'), { recursive: true, force: true });
});

describe('CMS purged content path snapshot', () => {
  it('deletes frozen paths even after the content row no longer exists', async () => {
    const target = resolveStaticFile('purge-snapshot-test', 'news/removed.html')!;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'old');
    await applyCmsContentPublishSnapshot({
      contentId: 99,
      siteId: 1,
      contentVersion: 3,
      channelId: 8,
      channelPath: 'news',
      slug: 'removed',
      bodyPages: 1,
      build: false,
      purged: true,
      targets: [],
      refreshChannelIds: [],
    }, ['news/removed.html']);
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
