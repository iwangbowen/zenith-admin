import { eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/types';
import { wikiDocs } from '../../db/schema';
import { buildWhere } from '../../lib/where-helpers';

/**
 * 目标层级（空间 + 父文档，根层级 `parentId` 为空）内下一个追加位的 `sort`：
 * 新建 / 批量导入的文档都追加到末尾，保持手工排序不被打乱。层级为空时返回 0。
 */
export async function nextWikiDocSort(executor: DbExecutor, spaceId: number, parentId: number | null | undefined): Promise<number> {
  const [{ maxSort }] = await executor.select({ maxSort: sql<number>`coalesce(max(${wikiDocs.sort}), -1)` })
    .from(wikiDocs)
    .where(buildWhere(
      eq(wikiDocs.spaceId, spaceId),
      parentId ? eq(wikiDocs.parentId, parentId) : isNull(wikiDocs.parentId),
      isNull(wikiDocs.deletedAt),
    ));
  return maxSort + 1;
}
