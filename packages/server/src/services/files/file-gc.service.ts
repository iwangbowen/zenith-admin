import { HTTPException } from 'hono/http-exception';
import { and, asc, eq, gte, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db';
import { fileStorageConfigs, managedFiles } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { deleteStoredFile } from '../../lib/file-storage';
import logger from '../../lib/logger';
import { registerSystemRecurringJob } from '../../lib/pg-boss-scheduler';

/**
 * 托管文件引用计数与延迟 GC。
 *
 * 归属模块（企业网盘版本 / 渲染产物等）在同一事务内对引用的对象 `retain` / `release`：
 * 计数归零 → 打 `orphanedAt` 标记进入宽限期；宽限期内被再次引用即复活（清除标记）；
 * 超过宽限期由系统任务 `files-gc` 删除对象与记录。请求路径不再直接删对象，
 * 也不再靠扫描各引用表判定"是否还有引用"。通用文件中心上传的 public 文件不参与计数。
 */

/** GC 宽限期（小时）：留出并发秒传 / 事务回滚窥见 0 计数的窗口 */
export const FILE_GC_GRACE_HOURS = 24;
const GC_BATCH = 200;

/** 增加引用计数（同一 id 出现多次按次数累加）；复活孤儿标记 */
export async function retainManagedFiles(executor: DbExecutor, fileIds: Array<string | null | undefined>): Promise<void> {
  const counts = countIds(fileIds);
  for (const [id, n] of counts) {
    const retained = await executor.update(managedFiles)
      .set({ refCount: sql`${managedFiles.refCount} + ${n}`, gcState: 'live', orphanedAt: null })
      .where(and(eq(managedFiles.id, id), ne(managedFiles.gcState, 'deleting')))
      .returning({ id: managedFiles.id });
    if (!retained.length) throw new HTTPException(409, { message: '文件已进入回收流程，请重新上传' });
  }
}

/** 减少引用计数；归零时打孤儿标记（不立即删除） */
export async function releaseManagedFiles(executor: DbExecutor, fileIds: Array<string | null | undefined>): Promise<void> {
  const counts = countIds(fileIds);
  for (const [id, n] of counts) {
    const released = await executor.update(managedFiles)
      .set({
        refCount: sql`${managedFiles.refCount} - ${n}`,
        gcState: sql`case when ${managedFiles.refCount} = ${n} then 'orphan'::file_gc_state else ${managedFiles.gcState} end`,
        orphanedAt: sql`case when ${managedFiles.refCount} = ${n} then now() else ${managedFiles.orphanedAt} end`,
      })
      .where(and(eq(managedFiles.id, id), gte(managedFiles.refCount, n), ne(managedFiles.gcState, 'deleting')))
      .returning({ id: managedFiles.id });
    if (!released.length) throw new Error(`Managed file reference count mismatch: ${id}`);
  }
}

function countIds(fileIds: Array<string | null | undefined>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of fileIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return new Map([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

function collectible(cutoff: Date) {
  return and(
    eq(managedFiles.visibility, 'restricted'),
    eq(managedFiles.refCount, 0),
    or(
      eq(managedFiles.gcState, 'deleting'),
      and(eq(managedFiles.gcState, 'orphan'), isNotNull(managedFiles.orphanedAt), lt(managedFiles.orphanedAt, cutoff)),
    ),
  );
}

/** 删除一批超过宽限期且计数仍为 0 的孤儿对象；返回删除数 */
export async function runManagedFileGc(graceHours = FILE_GC_GRACE_HOURS, batch = GC_BATCH): Promise<{ deleted: number; failed: number }> {
  const cutoff = new Date(Date.now() - graceHours * 3_600_000);
  const rows = await db.select({ id: managedFiles.id }).from(managedFiles)
    .where(collectible(cutoff))
    .orderBy(asc(managedFiles.orphanedAt), asc(managedFiles.id))
    .limit(batch);
  if (rows.length === 0) return { deleted: 0, failed: 0 };
  let deleted = 0;
  let failed = 0;
  for (const file of rows) {
    try {
      // Commit the tombstone before external I/O: a crashed delete can never be resurrected.
      const claimed = await db.update(managedFiles).set({ gcState: 'deleting' })
        .where(and(eq(managedFiles.id, file.id), collectible(cutoff)))
        .returning({ id: managedFiles.id });
      if (!claimed.length) continue;
      const removed = await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(managedFiles)
          .where(and(eq(managedFiles.id, file.id), eq(managedFiles.gcState, 'deleting'), eq(managedFiles.refCount, 0)))
          .for('update', { skipLocked: true });
        if (!locked) return false;
        const [cfg] = await tx.select().from(fileStorageConfigs).where(eq(fileStorageConfigs.id, locked.storageConfigId));
        if (!cfg) throw new Error(`Missing storage configuration: ${locked.storageConfigId}`);
        await deleteStoredFile(locked, cfg);
        await tx.delete(managedFiles).where(eq(managedFiles.id, locked.id));
        return true;
      });
      if (removed) deleted += 1;
    } catch (err) {
      failed += 1;
      logger.warn({ err, fileId: file.id }, 'files-gc: 删除孤儿对象失败，下轮重试');
    }
  }
  return { deleted, failed };
}

export async function countPendingManagedFileGc(graceHours = FILE_GC_GRACE_HOURS): Promise<number> {
  const cutoff = new Date(Date.now() - graceHours * 3_600_000);
  return db.$count(managedFiles, collectible(cutoff));
}

/** 系统周期任务：每小时清理一批孤儿对象 */
export async function registerManagedFileGcJob(): Promise<void> {
  await registerSystemRecurringJob({
    name: 'files-gc',
    title: '托管文件孤儿对象回收',
    module: '文件与存储',
    cronExpression: '15 * * * *',
    description: `删除引用计数归零且超过 ${FILE_GC_GRACE_HOURS} 小时宽限期的托管文件对象与记录（网盘版本 / 渲染产物等归属模块引用的 restricted 文件）。`,
    allowManualRun: true,
    run: async () => {
      let total = 0;
      let failed = 0;
      for (let round = 0; round < 20; round++) {
        const r = await runManagedFileGc();
        total += r.deleted;
        failed += r.failed;
        if (r.failed > 0 || r.deleted < GC_BATCH) break;
      }
      return `回收 ${total} 个对象${failed ? `，${failed} 个失败` : ''}`;
    },
  });
}
