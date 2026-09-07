import { createRequire } from 'node:module';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import { driveNodes, driveNodeRenditions, driveNodeTexts, type DriveNodeRow } from '../../db/schema';
import { readStoredFile } from '../../lib/file-storage';
import { registerSystemQueueWorker, registerSystemRecurringJob, sendSystemJob } from '../../lib/pg-boss-scheduler';
import { getRestrictedFileForRead, saveGeneratedManagedFile } from '../files/files.service';
import { releaseManagedFiles, retainManagedFiles } from '../files/file-gc.service';
import { getDriveSettings } from './drive-settings.service';

const require = createRequire(import.meta.url);
const QUEUE = 'drive-renditions';
const THUMBNAIL_MAX_BYTES = 40 * 1024 * 1024;
const TEXT_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_MAX_CHARS = 200_000;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/tiff', 'image/bmp', 'image/heic', 'image/heif']);
const TEXT_MIMES = new Set(['application/json', 'application/xml', 'application/javascript', 'application/typescript', 'application/x-yaml', 'application/sql', 'application/x-sh', 'application/csv']);
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'conf', 'cfg', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'c', 'h', 'cpp', 'cs', 'sql', 'sh', 'bat', 'ps1', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'toml', 'properties']);

type RenditionJob = { nodeId: number; version: number; kind: 'thumbnail' | 'text' };

export function isThumbnailCandidate(node: Pick<DriveNodeRow, 'type' | 'mimeType' | 'size'>): boolean {
  return node.type === 'file' && IMAGE_MIMES.has(node.mimeType?.toLowerCase() ?? '') && node.size > 0 && node.size <= THUMBNAIL_MAX_BYTES;
}

export function isTextIndexCandidate(node: Pick<DriveNodeRow, 'type' | 'mimeType' | 'extension' | 'size'>): boolean {
  const mime = node.mimeType?.toLowerCase() ?? '';
  return node.type === 'file' && node.size > 0 && node.size <= TEXT_MAX_BYTES
    && (mime.startsWith('text/') || TEXT_MIMES.has(mime) || TEXT_EXTENSIONS.has(node.extension?.toLowerCase() ?? ''));
}

async function sourceBuffer(fileId: string, limit: number): Promise<Buffer> {
  const { file, storageConfig } = await getRestrictedFileForRead(fileId);
  const { stream } = await readStoredFile(file, storageConfig);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Rendition source exceeds the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function enqueue(job: RenditionJob): Promise<void> {
  await sendSystemJob(QUEUE, job, { singletonKey: `${job.nodeId}:${job.version}:${job.kind}`, singletonSeconds: 300 });
}

/** The rendition row is also an outbox: startup/periodic reconciliation recovers an interrupted send. */
export async function scheduleNodeRenditions(nodeId: number): Promise<void> {
  const settings = await getDriveSettings();
  const jobs = await db.transaction(async (tx) => {
    const [node] = await tx.select().from(driveNodes).where(and(eq(driveNodes.id, nodeId), isNull(driveNodes.deletedAt))).for('update');
    if (!node?.fileId) return [];
    const kinds: RenditionJob['kind'][] = [];
    if (settings.thumbnailEnabled && isThumbnailCandidate(node)) kinds.push('thumbnail');
    if (settings.textIndexEnabled && isTextIndexCandidate(node)) kinds.push('text');
    const queued: RenditionJob[] = [];
    for (const kind of kinds) {
      const [existing] = await tx.select().from(driveNodeRenditions)
        .where(and(eq(driveNodeRenditions.nodeId, node.id), eq(driveNodeRenditions.kind, kind)));
      if (existing?.version === node.currentVersion && existing.status === 'ready') continue;
      await releaseManagedFiles(tx, [existing?.fileId]);
      await tx.insert(driveNodeRenditions).values({ nodeId: node.id, version: node.currentVersion, kind })
        .onConflictDoUpdate({
          target: [driveNodeRenditions.nodeId, driveNodeRenditions.kind],
          set: { version: node.currentVersion, status: 'pending', fileId: null, error: null },
        });
      queued.push({ nodeId: node.id, version: node.currentVersion, kind });
    }
    return queued;
  });
  for (const job of jobs) await enqueue(job);
}

export async function processDriveRendition(job: RenditionJob): Promise<void> {
  const match = and(eq(driveNodeRenditions.nodeId, job.nodeId), eq(driveNodeRenditions.version, job.version), eq(driveNodeRenditions.kind, job.kind));
  const [node] = await db.select().from(driveNodes).where(and(eq(driveNodes.id, job.nodeId), eq(driveNodes.currentVersion, job.version), isNull(driveNodes.deletedAt)));
  const [rendition] = await db.select().from(driveNodeRenditions).where(match);
  if (!node?.fileId || !rendition || rendition.status === 'ready') return;
  try {
    const source = await sourceBuffer(node.fileId, job.kind === 'thumbnail' ? THUMBNAIL_MAX_BYTES : TEXT_MAX_BYTES);
    let fileId: string | null = null;
    let content: string | null = null;
    if (job.kind === 'thumbnail') {
      const actorId = node.updatedBy ?? node.createdBy;
      if (!actorId) throw new Error('Rendition owner is missing');
      const sharp = require('sharp') as typeof import('sharp')['default'];
      const buffer = await sharp(source).rotate().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const file = await saveGeneratedManagedFile({
        buffer, filename: `thumb-${node.id}-v${job.version}.webp`, mimeType: 'image/webp',
        tenantId: node.tenantId, createdBy: actorId, visibility: 'restricted',
      });
      fileId = file.id;
    } else {
      content = source.toString('utf8').replaceAll('\u0000', '').slice(0, TEXT_MAX_CHARS);
    }
    await db.transaction(async (tx) => {
      const [current] = await tx.select({ id: driveNodes.id }).from(driveNodes)
        .where(and(eq(driveNodes.id, node.id), eq(driveNodes.currentVersion, job.version), isNull(driveNodes.deletedAt))).for('update');
      if (!current) return;
      const [pending] = await tx.select().from(driveNodeRenditions).where(match);
      if (!pending || pending.status === 'ready') return;
      await retainManagedFiles(tx, [fileId]);
      await releaseManagedFiles(tx, [pending.fileId]);
      if (content !== null) {
        const searchVector = sql`to_tsvector('simple', ${content})`;
        await tx.insert(driveNodeTexts).values({ nodeId: node.id, version: job.version, content, searchVector })
          .onConflictDoUpdate({ target: driveNodeTexts.nodeId, set: { version: job.version, content, searchVector } });
      }
      await tx.update(driveNodeRenditions).set({ status: 'ready', fileId, error: null }).where(match);
    });
  } catch (err) {
    await db.update(driveNodeRenditions).set({
      status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    }).where(and(match, eq(driveNodeRenditions.status, 'pending')));
    throw err;
  }
}

export async function registerDriveRenditionWorker(): Promise<void> {
  await registerSystemQueueWorker<RenditionJob>({
    name: QUEUE, title: '网盘渲染产物', module: '企业网盘',
    queueOptions: { retryLimit: 3, retryDelay: 30, expireInSeconds: 300 },
    handler: processDriveRendition,
  });
  const reconcile = async () => {
    const rows = await db.select({ nodeId: driveNodeRenditions.nodeId, version: driveNodeRenditions.version, kind: driveNodeRenditions.kind })
      .from(driveNodeRenditions).where(eq(driveNodeRenditions.status, 'pending')).limit(500);
    for (const row of rows) {
      if (row.kind === 'thumbnail' || row.kind === 'text') await enqueue({ ...row, kind: row.kind });
    }
    return `已补投 ${rows.length} 个待处理产物`;
  };
  await reconcile();
  await registerSystemRecurringJob({
    name: 'drive-renditions-reconcile', title: '网盘渲染任务补投', module: '企业网盘',
    cronExpression: '*/5 * * * *', allowManualRun: true, run: reconcile,
  });
}
