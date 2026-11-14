import { createReadStream, createWriteStream } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { buildZipStream } from '../zip';
import { leafColumns, renderExportToPath } from './writer';
import type { AnyExportDefinition, ExportRuntimeContext } from './types';
export interface ExportPart { name: string; rowCount: number; bytes: number; sha256: string }
/** One source iterator, one open part, and one row of lookahead; no full-result buffer. */
export async function renderPartitionedExport(definition: AnyExportDefinition, rows: AsyncIterable<Record<string, unknown>>, ctx: ExportRuntimeContext, folder: string, rowsPerPart: number, total: number) {
  const iterator = rows[Symbol.asyncIterator]();
  const parts: ExportPart[] = [];
  const budget = ctx.byteLimit ?? 128 * 1024 * 1024;
  let next = await iterator.next();
  let processed = 0;
  let bytes = 0;
  try {
    do {
      if (parts.length >= 200) throw new Error('分卷数量超过200，请增大每卷行数');
      const name = 'part-' + String(parts.length + 1).padStart(4, '0') + '.' + ctx.format;
      const path = join(folder, name);
      const offset = processed;
      async function* partRows() {
        let count = 0;
        while (!next.done && count < rowsPerPart) {
          if (ctx.rowLimit && processed >= ctx.rowLimit) throw new Error('导出总行数超过上限，请收窄条件');
          const row = next.value;
          processed++; count++;
          yield row;
          next = await iterator.next();
        }
      }
      const rowCount = await renderExportToPath(definition, partRows(), {
        ...ctx, byteLimit: Math.max(1, budget - bytes),
        progress: (count) => ctx.progress?.(offset + count, total) ?? Promise.resolve(),
      }, path, Math.min(rowsPerPart, Math.max(0, total - offset)));
      const info = await stat(path);
      bytes += info.size;
      if (bytes > budget) throw new Error('分卷总大小超过导出字节预算');
      const digest = createHash('sha256');
      for await (const chunk of createReadStream(path)) digest.update(chunk);
      parts.push({ name, rowCount, bytes: info.size, sha256: digest.digest('hex') });
    } while (!next.done);
    const columns = definition.resolveColumns ? await definition.resolveColumns(ctx.query, ctx.currentUser) : definition.columns;
    const manifest = { version: 1, entity: definition.entity, format: ctx.format, raw: ctx.raw, masked: ctx.masked, generatedAt: ctx.exportedAt.toISOString(), rowCount: processed, columns: ctx.selectedColumns ?? leafColumns(columns).map(c => c.key), parts };
    const manifestPath = join(folder, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    const zipPath = join(folder, 'export.zip');
    const archive = await buildZipStream([
      ...parts.map(part => ({ name: part.name, open: async () => createReadStream(join(folder, part.name)) })),
      { name: 'manifest.json', open: async () => createReadStream(manifestPath) },
    ], { onEntry: async () => { await ctx.progress?.(processed, total); } });
    await pipeline(archive, createWriteStream(zipPath, { flags: 'wx' }));
    if ((await stat(zipPath)).size > budget) throw new Error('分卷压缩包超过导出字节预算');
    return { filePath: zipPath, rowCount: processed, manifest };
  } finally { await iterator.return?.(); }
}
