import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStoredFile } from './file-storage';
import type { FileStorageConfigRow } from '../db/schema';
it('rejects a missing local object before returning a successful download stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'storage-read-proof-'));
  try {
    const config = { provider: 'local', localRootPath: root } as FileStorageConfigRow;
    const file = { objectKey: 'missing.csv', originalName: 'report.csv', provider: 'local', bucketName: null, mimeType: 'text/csv' } as Parameters<typeof readStoredFile>[0];
    await expect(readStoredFile(file, config)).rejects.toMatchObject({ status: 410 });
    await writeFile(join(root, 'missing.csv'), 'abcdef');
    const result = await readStoredFile(file, config, { start: 1, end: 3 });
    expect(await new Response(result.stream).text()).toBe('bcd');
  } finally { await rm(root, { recursive: true, force: true }); }
});
