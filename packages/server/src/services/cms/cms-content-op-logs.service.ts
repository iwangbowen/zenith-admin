import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContentOpLogs } from '../../db/schema';
import type { CmsContentOpLogRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime } from '../../lib/datetime';
import { currentUserOrNull } from '../../lib/context';
import logger from '../../lib/logger';
import { CMS_CONTENT_OP_ACTION_LABELS } from '@zenith/shared';

export type CmsContentOpAction = keyof typeof CMS_CONTENT_OP_ACTION_LABELS;

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export function mapCmsContentOpLog(row: CmsContentOpLogRow) {
  return {
    id: row.id,
    contentId: row.contentId,
    action: row.action,
    actionLabel: CMS_CONTENT_OP_ACTION_LABELS[row.action as CmsContentOpAction] ?? row.action,
    detail: row.detail ?? null,
    operatorId: row.operatorId ?? null,
    operatorName: row.operatorName,
    createdAt: formatDateTime(row.createdAt),
  };
}

function operatorSnapshot() {
  const user = currentUserOrNull();
  return { operatorId: user?.userId ?? null, operatorName: user?.username ?? '系统' };
}

/** 记录单条内容操作日志（时间线埋点；写入失败仅告警，不阻断主流程） */
export async function logContentOp(executor: DbExecutor, contentId: number, action: CmsContentOpAction, detail?: string | null): Promise<void> {
  try {
    await executor.insert(cmsContentOpLogs).values({
      contentId,
      action,
      detail: detail ? detail.slice(0, 500) : null,
      ...operatorSnapshot(),
    });
  } catch (err) {
    logger.warn(`[CMS] 内容操作日志写入失败（contentId=${contentId}, action=${action}）`, err);
  }
}

/** 批量记录同一动作的操作日志（回收/恢复/移动等批量操作） */
export async function logContentOps(executor: DbExecutor, contentIds: number[], action: CmsContentOpAction, detail?: string | null): Promise<void> {
  if (contentIds.length === 0) return;
  const snapshot = operatorSnapshot();
  try {
    await executor.insert(cmsContentOpLogs).values(contentIds.map((contentId) => ({
      contentId,
      action,
      detail: detail ? detail.slice(0, 500) : null,
      ...snapshot,
    })));
  } catch (err) {
    logger.warn(`[CMS] 内容操作日志批量写入失败（action=${action}, count=${contentIds.length}）`, err);
  }
}

/** 内容操作时间线（新→旧，最多返回最近 100 条） */
export async function listContentOpLogs(contentId: number) {
  const rows = await db.select().from(cmsContentOpLogs)
    .where(eq(cmsContentOpLogs.contentId, contentId))
    .orderBy(desc(cmsContentOpLogs.id))
    .limit(100);
  return rows.map(mapCmsContentOpLog);
}

/** 清理指定内容集合的日志（仅供物化/维护场景显式调用；常规删除走 FK 级联） */
export async function purgeContentOpLogs(executor: DbExecutor, contentIds: number[]): Promise<void> {
  if (contentIds.length === 0) return;
  await executor.delete(cmsContentOpLogs).where(inArray(cmsContentOpLogs.contentId, contentIds));
}
