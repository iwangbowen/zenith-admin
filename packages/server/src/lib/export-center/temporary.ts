import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const MAX_TEMP_AGE_MS = 24 * 3600 * 1000;
/** Only owned mkdtemp names, never symbolic links; active runs are bounded to ten minutes. */
export async function cleanupAbandonedExportTemps(root = tmpdir(), now = Date.now()) {
  let deleted = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^zenith-export-[A-Za-z0-9]{6}$/u.test(entry.name)) continue;
    const path = join(root, entry.name);
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink() || now - info.mtimeMs <= MAX_TEMP_AGE_MS) continue;
      await rm(path, { recursive: true, force: true }); deleted++;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return deleted;
}
