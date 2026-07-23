import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { recordCmsPublishArtifact } = vi.hoisted(() => ({ recordCmsPublishArtifact: vi.fn() }));
vi.mock('./cms-publish-artifact-tracker', () => ({ recordCmsPublishArtifact }));

import { deleteStaticFile, resolveStaticFile, siteStaticDir } from './cms-static.service';

const SITE_CODE = 'stage3-delete-test';

afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(siteStaticDir(SITE_CODE), { recursive: true, force: true });
});

describe('CMS static deletion artifact facts', () => {
  it('records deletion only when the physical file actually existed', async () => {
    const target = resolveStaticFile(SITE_CODE, 'news/index_2.html')!;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '<html>old</html>');

    await expect(deleteStaticFile(SITE_CODE, 'news/index_2.html')).resolves.toBe(true);
    expect(recordCmsPublishArtifact).toHaveBeenCalledTimes(1);
    expect(recordCmsPublishArtifact).toHaveBeenCalledWith({ relPath: 'news/index_2.html', status: 'deleted' });

    await expect(deleteStaticFile(SITE_CODE, 'news/index_2.html')).resolves.toBe(false);
    expect(recordCmsPublishArtifact).toHaveBeenCalledTimes(1);
  });
});
