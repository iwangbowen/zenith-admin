import { HTTPException } from 'hono/http-exception';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { PassThrough, Readable } from 'node:stream';
import { formatBytes } from '@zenith/shared/core';
import {
  DRIVE_SYNC_ZIP_MAX_BYTES,
  DRIVE_SYNC_ZIP_MAX_FILES,
  driveRoleAtLeast,
  type DriveBatchDownloadResult,
} from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodes, driveSpaces, fileStorageConfigs, managedFiles, type DriveNodeRow, type DriveSpaceRow } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { readStoredFile } from '../../lib/file-storage';
import logger from '../../lib/logger';
import { registerTaskHandler, submitAsyncTask, TaskCancelledError } from '../../lib/task-center';
import { saveGeneratedManagedFile } from '../files/files.service';
import { resolveNodeRoles } from './drive-access.service';
import { logDriveActivity } from './drive-activity.service';
import { enrichNode, isTextIndexCandidate, isThumbnailCandidate } from './drive-enrichment.service';
import { copySubtree, loadNodesByIds, loadSubtree, purgeExpiredRecycleNodes, resolveWritableParent } from './drive-nodes.service';
import { notifyBatchDownloadReady } from './drive-notify.service';
import { recalcSpaceUsage } from './drive-spaces.service';
import { getDriveSettings } from './drive-settings.service';

// ─── 打包下载 ─────────────────────────────────────────────────────────────────

interface ZipEntry {
  /** zip 内相对路径（含子目录） */
  entryName: string;
  fileId: string;
}

/** 展开所选节点为 zip 条目：文件夹递归带路径，同名文件自动去重 */
async function collectZipEntries(nodes: DriveNodeRow[]): Promise<{ entries: ZipEntry[]; totalBytes: number }> {
  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  const used = new Set<string>();
  const unique = (name: string) => {
    let candidate = name;
    let n = 1;
    while (used.has(candidate.toLowerCase())) {
      const idx = name.lastIndexOf('.');
      candidate = idx > 0 ? `${name.slice(0, idx)}_${n}${name.slice(idx)}` : `${name}_${n}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
  for (const node of nodes) {
    if (node.type === 'file') {
      if (!node.fileId) continue;
      entries.push({ entryName: unique(node.name), fileId: node.fileId });
      totalBytes += node.size;
      continue;
    }
    const subtree = await loadSubtree(db, node.id);
    const pathMap = new Map<number, string>([[node.id, unique(node.name)]]);
    for (const child of subtree) {
      if (child.id === node.id) continue;
      const parentPath = pathMap.get(child.parentId!) ?? pathMap.get(node.id)!;
      const path = `${parentPath}/${child.name}`;
      pathMap.set(child.id, path);
      if (child.type === 'file' && child.fileId) {
        entries.push({ entryName: path, fileId: child.fileId });
        totalBytes += child.size;
      }
    }
  }
  return { entries, totalBytes };
}

async function ensureDownloadable(ids: number[]): Promise<DriveNodeRow[]> {
  const rows = await loadNodesByIds(ids);
  const roleMap = await resolveNodeRoles(rows);
  for (const row of rows) {
    if (!driveRoleAtLeast(roleMap.get(row.id)?.role, 'downloader')) throw new HTTPException(403, { message: `没有下载权限：${row.name}` });
  }
  return rows;
}

/** 把 zip 条目流式写入 archiver，返回 Node 可读流 */
async function buildZipStream(entries: ZipEntry[], onEntry?: (index: number) => Promise<void>): Promise<Readable> {
  const fileIds = [...new Set(entries.map((e) => e.fileId))];
  const files = fileIds.length ? await db.select().from(managedFiles).where(inArray(managedFiles.id, fileIds)) : [];
  const fileMap = new Map(files.map((f) => [f.id, f]));
  const configIds = [...new Set(files.map((f) => f.storageConfigId))];
  const configs = configIds.length ? await db.select().from(fileStorageConfigs).where(inArray(fileStorageConfigs.id, configIds)) : [];
  const configMap = new Map(configs.map((c) => [c.id, c]));
  const { ZipArchive } = await import('archiver');
  const archive = new ZipArchive({ zlib: { level: 5 } });
  const passThrough = new PassThrough();
  archive.on('error', (err: Error) => passThrough.destroy(err));
  archive.pipe(passThrough);
  void (async () => {
    for (const [index, entry] of entries.entries()) {
      const file = fileMap.get(entry.fileId);
      const config = file ? configMap.get(file.storageConfigId) : undefined;
      if (!file || !config) continue;
      try {
        const { stream } = await readStoredFile(file, config);
        archive.append(Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]), { name: entry.entryName });
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { archive.off('entry', done); archive.off('error', fail); };
          const done = () => { cleanup(); resolve(); };
          const fail = (err: Error) => { cleanup(); reject(err); };
          archive.once('entry', done);
          archive.once('error', fail);
        });
        if (onEntry) await onEntry(index + 1);
      } catch (err) {
        if (err instanceof TaskCancelledError) throw err;
        logger.warn({ err, fileId: entry.fileId }, 'drive: 打包时跳过读取失败的文件');
      }
    }
    await archive.finalize();
  })().catch((err) => passThrough.destroy(err instanceof Error ? err : new Error(String(err))));
  return passThrough;
}

/**
 * 批量下载：小于阈值直接流式返回 zip；否则提交任务中心异步打包。
 */
export async function batchDownloadDriveNodes(ids: number[]): Promise<
  | { mode: 'sync'; stream: ReadableStream; filename: string }
  | { mode: 'task'; result: DriveBatchDownloadResult }
> {
  const rows = await ensureDownloadable(ids);
  const { entries, totalBytes } = await collectZipEntries(rows);
  if (entries.length === 0) throw new HTTPException(400, { message: '所选项目中没有可下载的文件' });
  if (entries.length > DRIVE_SYNC_ZIP_MAX_FILES || totalBytes > DRIVE_SYNC_ZIP_MAX_BYTES) {
    const task = await submitAsyncTask({
      taskType: 'drive-batch-download',
      title: `打包下载 ${entries.length} 个文件（${formatBytes(totalBytes)}）`,
      payload: { ids: rows.map((r) => r.id) },
    });
    return { mode: 'task', result: { mode: 'task', taskId: task.id } };
  }
  for (const row of rows) {
    await logDriveActivity({ spaceId: row.spaceId, nodeId: row.id, nodeName: row.name, nodeType: row.type, action: 'download', detail: { batch: true } });
  }
  const stream = await buildZipStream(entries);
  const filename = rows.length === 1 ? `${rows[0].name}.zip` : `drive_${Date.now()}.zip`;
  return { mode: 'sync', stream: Readable.toWeb(stream) as ReadableStream, filename };
}

// ─── 任务中心 handler ─────────────────────────────────────────────────────────

export function registerDriveTaskHandlers(): void {
  registerTaskHandler({
    taskType: 'drive-batch-download',
    title: '网盘打包下载',
    module: '企业网盘',
    description: '大批量文件异步打包为 zip，完成后通知下载',
    allowConcurrent: true,
    maxAttempts: 2,
    retryDelayMs: 5000,
    retentionDays: 7,
    async run(ctx) {
      const ids = (ctx.payload.ids as number[]) ?? [];
      const rows = await ensureDownloadable(ids);
      const { entries, totalBytes } = await collectZipEntries(rows);
      await ctx.progress({ processed: 0, total: entries.length, note: '开始打包' });
      const stream = await buildZipStream(entries, async (done) => {
        const { cancelRequested } = await ctx.progress({ processed: done, total: entries.length, note: `已打包 ${done}/${entries.length}` });
        if (cancelRequested) throw new TaskCancelledError('用户取消打包');
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      const user = currentUser();
      const file = await saveGeneratedManagedFile({
        buffer,
        filename: `drive_${Date.now()}.zip`,
        mimeType: 'application/zip',
        tenantId: user.tenantId ?? null,
        createdBy: user.userId,
      });
      const downloadUrl = `/api/files/${file.id}/content`;
      for (const row of rows) {
        await logDriveActivity({ spaceId: row.spaceId, nodeId: row.id, nodeName: row.name, nodeType: row.type, action: 'download', detail: { batch: true, taskId: ctx.taskId } });
      }
      await notifyBatchDownloadReady(user.userId, user.tenantId ?? null, entries.length, totalBytes, downloadUrl, `drive-zip:${ctx.taskId}`);
      return { fileId: file.id, downloadUrl, fileCount: entries.length, bytes: buffer.length };
    },
  });

  registerTaskHandler({
    taskType: 'drive-copy-subtree',
    title: '网盘批量复制',
    module: '企业网盘',
    description: '大目录树复制（元数据 + 对象引用），按根节点断点续跑',
    allowConcurrent: false,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
    async run(ctx) {
      const ids = (ctx.payload.ids as number[]) ?? [];
      const targetSpaceId = Number(ctx.payload.targetSpaceId);
      const targetParentId = ctx.payload.targetParentId == null ? null : Number(ctx.payload.targetParentId);
      const doneIds = new Set<number>((ctx.checkpoint?.doneIds as number[]) ?? []);
      const rows = await loadNodesByIds(ids);
      const { space, parent, ancestorIds } = await resolveWritableParent(targetSpaceId, targetParentId);
      const settings = await getDriveSettings();
      let copied = Number(ctx.checkpoint?.copied ?? 0);
      for (const [index, row] of rows.entries()) {
        if (!doneIds.has(row.id)) {
          const subtree = await loadSubtree(db, row.id);
          copied += await db.transaction((tx) => copySubtree(tx, subtree, space, parent?.id ?? null, ancestorIds, settings));
          doneIds.add(row.id);
        }
        const { cancelRequested } = await ctx.progress({
          processed: index + 1, total: rows.length, note: `已复制 ${copied} 个节点`,
          checkpoint: { doneIds: [...doneIds], copied },
        });
        if (cancelRequested) return { copied };
      }
      return { copied };
    },
  });

  registerTaskHandler({
    taskType: 'drive-recalc-usage',
    title: '网盘容量重算',
    module: '企业网盘',
    description: '按版本表重算全部空间的已用容量（对账）',
    allowConcurrent: false,
    maxAttempts: 1,
    retentionDays: 30,
    async run(ctx) {
      const spaceId = ctx.payload.spaceId ? Number(ctx.payload.spaceId) : null;
      const spaces: Pick<DriveSpaceRow, 'id' | 'name'>[] = spaceId
        ? await db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(eq(driveSpaces.id, spaceId))
        : await db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces);
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      for (let i = processed; i < spaces.length; i++) {
        const used = await recalcSpaceUsage(spaces[i].id);
        processed = i + 1;
        await ctx.reportItems([{ key: `space-${spaces[i].id}`, label: spaces[i].name, status: 'success', message: formatBytes(used) }]);
        const { cancelRequested } = await ctx.progress({ processed, total: spaces.length, checkpoint: { processed } });
        if (cancelRequested) return { processed };
      }
      return { processed };
    },
  });

  registerTaskHandler({
    taskType: 'drive-reindex',
    title: '网盘缩略图 / 全文索引补建',
    module: '企业网盘',
    description: '为缺失缩略图或正文索引的文件补建（可按空间）',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 10_000,
    retentionDays: 30,
    async run(ctx) {
      const settings = await getDriveSettings();
      const spaceId = ctx.payload.spaceId ? Number(ctx.payload.spaceId) : null;
      const rows = await db.select().from(driveNodes).where(and(
        eq(driveNodes.type, 'file'),
        isNull(driveNodes.deletedAt),
        spaceId ? eq(driveNodes.spaceId, spaceId) : sql`true`,
      ));
      const candidates = rows.filter((r) => (settings.thumbnailEnabled && !r.thumbnailFileId && isThumbnailCandidate(r)) || (settings.textIndexEnabled && isTextIndexCandidate(r)));
      let processed = Number(ctx.checkpoint?.processed ?? 0);
      for (let i = processed; i < candidates.length; i++) {
        await enrichNode(candidates[i].id);
        processed = i + 1;
        const { cancelRequested } = await ctx.progress({ processed, total: candidates.length, note: candidates[i].name, checkpoint: { processed } });
        if (cancelRequested) return { processed };
      }
      return { processed };
    },
  });

  registerTaskHandler({
    taskType: 'drive-purge-recycle',
    title: '网盘回收站清理',
    module: '企业网盘',
    description: '彻底删除超过保留期的回收站项目并释放存储对象',
    allowConcurrent: false,
    maxAttempts: 1,
    retentionDays: 30,
    async run(ctx) {
      const settings = await getDriveSettings();
      const days = ctx.payload.days ? Number(ctx.payload.days) : settings.recycleRetentionDays;
      const purged = await purgeExpiredRecycleNodes(days);
      await ctx.progress({ processed: purged, total: purged, note: `已清理 ${purged} 个节点` });
      return { purged };
    },
  });
}

/** 管理端手动触发容量重算 */
export async function submitRecalcUsageTask(spaceId?: number) {
  return submitAsyncTask({
    taskType: 'drive-recalc-usage',
    title: spaceId ? `重算空间 #${spaceId} 容量` : '重算全部网盘空间容量',
    payload: { spaceId: spaceId ?? null },
    idempotencyKey: `drive-recalc:${spaceId ?? 'all'}:${currentUserId()}:${Math.floor(Date.now() / 60_000)}`,
  });
}

export async function submitReindexTask(spaceId?: number) {
  return submitAsyncTask({
    taskType: 'drive-reindex',
    title: spaceId ? `补建空间 #${spaceId} 缩略图 / 索引` : '补建全部网盘缩略图 / 索引',
    payload: { spaceId: spaceId ?? null },
  });
}
