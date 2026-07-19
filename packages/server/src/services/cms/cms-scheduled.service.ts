import { and, lte, ne, isNull, isNotNull, eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsContents } from '../../db/schema';
import logger from '../../lib/logger';
import { refreshContentStatic } from './cms-static.service';
import { triggerAutoPushForContent } from './cms-push.service';

/**
 * CMS 定时发布（系统周期任务，每分钟执行）：
 * 扫描 scheduledAt 到期且未发布的内容 → 自动发布 + 增量静态化 + 搜索引擎推送。
 */
export async function publishScheduledCmsContents(): Promise<string> {
  const now = new Date();
  const due = await db.select({ id: cmsContents.id, title: cmsContents.title })
    .from(cmsContents)
    .where(and(
      isNotNull(cmsContents.scheduledAt),
      lte(cmsContents.scheduledAt, now),
      ne(cmsContents.status, 'published'),
      isNull(cmsContents.deletedAt),
    ))
    .limit(200);
  if (due.length === 0) return '无到期的定时发布内容';

  let published = 0;
  for (const row of due) {
    try {
      await db.update(cmsContents)
        .set({ status: 'published', publishedAt: now, scheduledAt: null, rejectReason: null })
        .where(eq(cmsContents.id, row.id));
      published += 1;
      await refreshContentStatic(row.id).catch((err) => {
        logger.error(`[CMS] 定时发布内容 ${row.id} 静态化失败`, err);
      });
      triggerAutoPushForContent(row.id);
    } catch (err) {
      logger.error(`[CMS] 定时发布内容 ${row.id} 失败`, err);
    }
  }
  return `定时发布 ${published}/${due.length} 条内容`;
}
