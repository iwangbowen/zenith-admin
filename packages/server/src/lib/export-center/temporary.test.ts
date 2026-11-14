import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupAbandonedExportTemps } from './temporary';
it('reclaims only old owned export directories and preserves active or unrelated paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'temp-cleanup-test-'));
  try {
    for (const name of ['zenith-export-a12345', 'zenith-export-b12345', 'zenith-export-unrelated']) await mkdir(join(root, name));
    await writeFile(join(root, 'zenith-export-a12345', 'partial.csv'), 'partial');
    const old = new Date(Date.now() - 48 * 3600000);
    await utimes(join(root, 'zenith-export-a12345'), old, old);
    await utimes(join(root, 'zenith-export-unrelated'), old, old);
    expect(await cleanupAbandonedExportTemps(root)).toBe(1);
    await expect(stat(join(root, 'zenith-export-a12345'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(join(root, 'zenith-export-b12345'))).isDirectory()).toBe(true);
    expect((await stat(join(root, 'zenith-export-unrelated'))).isDirectory()).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
