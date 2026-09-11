import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import type { DriveRecentItem, DriveSearchItem, DriveSharedItem, DriveSubjectType } from '@zenith/shared/drive';
import { driveNodeContract } from '@zenith/shared/drive';
import { db } from '../../db';
import { driveNodePermissions, driveNodes, driveNodeStars, driveNodeTags, driveNodeTexts, driveRecentAccess, driveSpaces, type DriveNodeRow } from '../../db/schema';
import { currentUser, currentUserId } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere, dateRangeConditions, keywordCondition, withPagination } from '../../lib/where-helpers';
import { attachNodeRoles, ensureNodeRole, loadDriveSubjects, subjectPairsCondition, visibleNodeCondition } from './drive-access.service';
import { decorateNodes, ensureDriveNodeExists } from './drive-nodes.service';

type DriveNodeViewQuery = QueryOutputOf<typeof driveNodeContract.starred>;

async function spaceNameMap(rows: Array<{ spaceId: number }>): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.spaceId))];
  if (ids.length === 0) return new Map();
  const spaces = await db.select({ id: driveSpaces.id, name: driveSpaces.name }).from(driveSpaces).where(inArray(driveSpaces.id, ids));
  return new Map(spaces.map((s) => [s.id, s.name]));
}

type DriveSubjects = Awaited<ReturnType<typeof loadDriveSubjects>>;

/**
 * 分页取出的节点行 → 展示节点（收藏 / 最近 / 与我共享 / 搜索四个视图共用的尾段）：
 * 挂当前用户角色、按角色装饰、补空间名。`visible` 是挂角色后的行（搜索用它取正文摘要），
 * `list` 与 `visible` 同序；需要按其它顺序或附加字段组装时用 `byId`。
 */
async function decorateVisibleNodes(rows: DriveNodeRow[], subjects: DriveSubjects) {
  const visible = await attachNodeRoles(rows, subjects);
  const names = await spaceNameMap(visible);
  const decorated = await decorateNodes(visible, new Map(visible.map((r) => [r.id, r.myRole])));
  const list = decorated.map((n) => ({ ...n, spaceName: names.get(n.spaceId) ?? '' }));
  return { visible, list, byId: new Map(list.map((n) => [n.id, n])) };
}

// ─── 收藏 ─────────────────────────────────────────────────────────────────────

export async function setDriveNodeStar(nodeId: number, starred: boolean): Promise<boolean> {
  const node = await ensureDriveNodeExists(nodeId);
  await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
  const uid = currentUserId();
  if (starred) {
    await db.insert(driveNodeStars).values({ userId: uid, nodeId }).onConflictDoNothing();
  } else {
    await db.delete(driveNodeStars).where(and(eq(driveNodeStars.userId, uid), eq(driveNodeStars.nodeId, nodeId)));
  }
  return starred;
}

export async function listStarredNodes(q: DriveNodeViewQuery) {
  const { page, pageSize } = q;
  const uid = currentUserId();
  const subjects = await loadDriveSubjects();
  const where = buildWhere(
    inArray(driveNodes.id, db.select({ id: driveNodeStars.nodeId }).from(driveNodeStars).where(eq(driveNodeStars.userId, uid))),
    isNull(driveNodes.deletedAt),
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
    tenantCondition(driveNodes, currentUser()),
    visibleNodeCondition(subjects),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveNodes, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveNodes).where(where).orderBy(desc(driveNodes.updatedAt), desc(driveNodes.id)).$dynamic(), page, pageSize);
      return (await decorateVisibleNodes(rows, subjects)).list;
    },
  });
}

// ─── 最近访问 ─────────────────────────────────────────────────────────────────

export async function listRecentNodes(q: DriveNodeViewQuery) {
  const { page, pageSize } = q;
  const uid = currentUserId();
  const subjects = await loadDriveSubjects();
  const where = buildWhere(
    eq(driveRecentAccess.userId, uid),
    isNull(driveNodes.deletedAt),
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
    tenantCondition(driveNodes, currentUser()),
    visibleNodeCondition(subjects),
  );
  const base = db.select({ node: driveNodes, lastAccessAt: driveRecentAccess.lastAccessAt, lastAction: driveRecentAccess.action })
    .from(driveRecentAccess)
    .innerJoin(driveNodes, eq(driveNodes.id, driveRecentAccess.nodeId))
    .where(where);
  return buildListResult({
    page,
    pageSize,
    count: async () => {
      const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(driveRecentAccess).innerJoin(driveNodes, eq(driveNodes.id, driveRecentAccess.nodeId)).where(where);
      return row?.count ?? 0;
    },
    rows: async () => {
      const rows = await withPagination(base.orderBy(desc(driveRecentAccess.lastAccessAt)).$dynamic(), page, pageSize);
      const { byId } = await decorateVisibleNodes(rows.map((r) => r.node), subjects);
      return rows
        .map((r): DriveRecentItem => ({
          ...byId.get(r.node.id)!,
          lastAccessAt: formatDateTime(r.lastAccessAt),
          lastAction: r.lastAction,
        }));
    },
  });
}

// ─── 与我共享 ─────────────────────────────────────────────────────────────────

export async function listSharedWithMe(q: DriveNodeViewQuery) {
  const { page, pageSize } = q;
  const subjects = await loadDriveSubjects();
  const grantWhere = and(
    subjectPairsCondition(driveNodePermissions, subjects),
    or(isNull(driveNodePermissions.expireAt), gt(driveNodePermissions.expireAt, new Date())),
  );
  const where = buildWhere(
    inArray(driveNodes.id, db.select({ id: driveNodePermissions.nodeId }).from(driveNodePermissions).where(grantWhere)),
    isNull(driveNodes.deletedAt),
    q.type ? eq(driveNodes.type, q.type) : undefined,
    keywordCondition(q.keyword, [driveNodes.name], 'ilike'),
    tenantCondition(driveNodes, currentUser()),
    visibleNodeCondition(subjects),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveNodes, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveNodes).where(where).orderBy(desc(driveNodes.updatedAt), desc(driveNodes.id)).$dynamic(), page, pageSize);
      const grants = rows.length
        ? await db.select().from(driveNodePermissions).where(and(inArray(driveNodePermissions.nodeId, rows.map((r) => r.id)), grantWhere))
        : [];
      // 同一节点多条命中：直接授权给本人优先，其次角色高者
      const priority: Record<DriveSubjectType, number> = { user: 4, user_group: 3, role: 2, department: 1 };
      const grantMap = new Map<number, { via: DriveSubjectType; role: typeof grants[number]['role'] }>();
      for (const g of grants) {
        const cur = grantMap.get(g.nodeId);
        if (!cur || priority[g.subjectType] > priority[cur.via]) grantMap.set(g.nodeId, { via: g.subjectType, role: g.role });
      }
      const { list } = await decorateVisibleNodes(rows, subjects);
      return list.map((n): DriveSharedItem => ({
        ...n,
        grantedVia: grantMap.get(n.id)?.via ?? 'user',
        grantedRole: grantMap.get(n.id)?.role ?? 'viewer',
      }));
    },
  });
}

// ─── 搜索 ─────────────────────────────────────────────────────────────────────

/** `simple` 分词器不切分中日韩文本：含 CJK 的关键词改用子串匹配，否则用 tsvector */
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;

function textMatchCondition(keyword: string): SQL {
  return CJK_PATTERN.test(keyword)
    ? keywordCondition(keyword, [driveNodeTexts.content], 'ilike')!
    : sql`${driveNodeTexts.searchVector} @@ plainto_tsquery('simple', ${keyword})`;
}

/** CJK 关键词的命中片段：以首次出现位置为中心截取窗口 */
function substringSnippet(content: string, keyword: string, radius = 40): string {
  const idx = content.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx < 0) return content.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(content.length, idx + keyword.length + radius);
  return `${start > 0 ? '…' : ''}${content.slice(start, end).replaceAll(/\s+/g, ' ')}${end < content.length ? '…' : ''}`;
}

export async function searchDriveNodes(q: QueryOutputOf<typeof driveNodeContract.search>) {
  const { page, pageSize } = q;
  const keyword = q.keyword?.trim();
  if (!keyword) throw new HTTPException(400, { message: '请输入搜索关键词' });
  const subjects = await loadDriveSubjects();
  const nameCondition = keywordCondition(keyword, [driveNodes.name], 'ilike');
  const textSub = db.select({ id: driveNodeTexts.nodeId }).from(driveNodeTexts).where(textMatchCondition(keyword));
  const matchCondition: SQL | undefined = q.fullText
    ? or(nameCondition!, inArray(driveNodes.id, textSub))
    : nameCondition;
  const where = buildWhere(
    matchCondition,
    isNull(driveNodes.deletedAt),
    q.spaceId !== undefined ? eq(driveNodes.spaceId, q.spaceId) : undefined,
    q.type ? eq(driveNodes.type, q.type) : undefined,
    q.extension ? eq(driveNodes.extension, q.extension.toLowerCase().replace(/^\./, '')) : undefined,
    q.tagId ? inArray(driveNodes.id, db.select({ id: driveNodeTags.nodeId }).from(driveNodeTags).where(eq(driveNodeTags.tagId, q.tagId))) : undefined,
    q.createdBy ? eq(driveNodes.createdBy, q.createdBy) : undefined,
    ...dateRangeConditions(driveNodes.updatedAt, q.startTime, q.endTime),
    tenantCondition(driveNodes, currentUser()),
    visibleNodeCondition(subjects),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(driveNodes, where),
    rows: async () => {
      const rows = await withPagination(db.select().from(driveNodes).where(where).orderBy(desc(driveNodes.updatedAt), desc(driveNodes.id)).$dynamic(), page, pageSize);
      const { visible, list } = await decorateVisibleNodes(rows, subjects);
      const isCjk = CJK_PATTERN.test(keyword);
      const snippets = q.fullText && visible.length
        ? await db.select({
          nodeId: driveNodeTexts.nodeId,
          snippet: isCjk
            ? driveNodeTexts.content
            : sql<string>`ts_headline('simple', ${driveNodeTexts.content}, plainto_tsquery('simple', ${keyword}), 'MaxFragments=2, MaxWords=24, MinWords=8')`,
        }).from(driveNodeTexts).where(and(
          inArray(driveNodeTexts.nodeId, visible.map((v) => v.id)),
          textMatchCondition(keyword),
        ))
        : [];
      const snippetMap = new Map(snippets.map((s) => [s.nodeId, isCjk ? substringSnippet(s.snippet, keyword) : s.snippet]));
      return list.map((n): DriveSearchItem => ({
        ...n,
        snippet: snippetMap.get(n.id) ?? null,
      }));
    },
  });
}

export type { DriveNodeRow };
