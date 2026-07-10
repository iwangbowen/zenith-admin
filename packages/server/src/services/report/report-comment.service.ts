import { HTTPException } from 'hono/http-exception';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { reportDashboardComments, users } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentTenantId, currentUser, hasPermission } from '../../lib/context';
import { sendSystemInApp } from '../messaging/in-app-messages.service';
import { ensureDashboardExists } from './report-dashboard.service';
import type { ReportDashboardCommentRow, ReportDashboardRow } from '../../db/schema';
import type {
  CreateReportCommentInput,
  ReportDashboardComment,
} from '@zenith/shared';

type UpdateReportCommentInput = { content: string };
type ResolveReportCommentInput = { resolved: boolean };

type CommentRowExt = ReportDashboardCommentRow & {
  user?: { nickname: string | null; username: string; avatar: string | null } | null;
  resolvedByUser?: { nickname: string | null; username: string } | null;
  replies?: CommentRowExt[];
};

function commentUserName(user: CommentRowExt['user'], userId: number | null): string | null {
  if (user) return user.nickname || user.username || null;
  if (userId === null) return '已注销用户';
  return null;
}

async function canManageComments(): Promise<boolean> {
  return hasPermission('report:dashboard:update');
}

function commentVisibleTo(row: ReportDashboardCommentRow, viewerId: number, canManage: boolean, hasVisibleReplies: boolean): boolean {
  if (!row.deletedAt) return true;
  return canManage || row.userId === viewerId || hasVisibleReplies;
}

export function mapComment(
  row: CommentRowExt,
  viewerId: number,
  canManage: boolean,
  replies: ReportDashboardComment[] = [],
): ReportDashboardComment {
  const visibleDeleted = !!row.deletedAt && (canManage || row.userId === viewerId || replies.length > 0);
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    widgetId: row.widgetId ?? null,
    parentId: row.parentId ?? null,
    content: row.deletedAt && !visibleDeleted ? '' : (row.deletedAt ? '该评论已删除' : row.content),
    userId: row.userId ?? null,
    userName: commentUserName(row.user, row.userId ?? null),
    userAvatar: row.user?.avatar ?? null,
    resolvedAt: formatNullableDateTime(row.resolvedAt),
    resolvedBy: row.resolvedBy ?? null,
    resolvedByName: row.resolvedByUser?.nickname || row.resolvedByUser?.username || null,
    deletedAt: formatNullableDateTime(row.deletedAt),
    updatedAt: formatDateTime(row.updatedAt),
    createdAt: formatDateTime(row.createdAt),
    replies,
    canEdit: !row.deletedAt && row.userId === viewerId,
    canDelete: !row.deletedAt && (row.userId === viewerId || canManage),
    canResolve: row.userId === viewerId || canManage,
  } as ReportDashboardComment;
}

function dashboardWidgetIds(dashboard: ReportDashboardRow): Set<string> {
  const ids = new Set<string>();
  for (const widget of ((dashboard.widgets ?? []) as Array<{ i?: string }>)) {
    if (widget.i) ids.add(widget.i);
  }
  const published = dashboard.publishedSnapshot;
  for (const widget of ((published?.widgets ?? []) as Array<{ i?: string }>)) {
    if (widget.i) ids.add(widget.i);
  }
  return ids;
}

async function ensureDashboardCommentable(dashboardId: number, widgetId?: string | null): Promise<ReportDashboardRow> {
  const dashboard = await ensureDashboardExists(dashboardId);
  if (widgetId) {
    const ids = dashboardWidgetIds(dashboard);
    if (!ids.has(widgetId)) throw new HTTPException(400, { message: '组件不存在于当前草稿/发布版本中' });
  }
  return dashboard;
}

async function ensureCommentExists(dashboardId: number, id: number): Promise<ReportDashboardCommentRow> {
  const [row] = await db.select().from(reportDashboardComments)
    .where(and(eq(reportDashboardComments.id, id), eq(reportDashboardComments.dashboardId, dashboardId)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '评论不存在' });
  return row;
}

function normalizeParentId(parent: ReportDashboardCommentRow): number {
  return parent.parentId ?? parent.id;
}

async function notifyMentions(
  dashboard: ReportDashboardRow,
  content: string,
  actorId: number,
): Promise<void> {
  const usernames = [...new Set([...content.matchAll(/@([a-zA-Z0-9._-]{2,64})/g)].map((match) => match[1]))];
  if (usernames.length === 0) return;
  const mentioned = await db.select({ id: users.id, username: users.username })
    .from(users)
    .where(inArray(users.username, usernames));
  const userIds = mentioned.map((row) => row.id).filter((id) => id !== actorId);
  if (userIds.length === 0) return;
  await sendSystemInApp({
    userIds,
    title: '仪表盘评论提及提醒',
    content: `你在仪表盘「${dashboard.name}」评论中被提及，请前往查看。`,
    type: 'info',
    tenantId: currentTenantId(),
  });
}

export async function listComments(
  dashboardId: number,
  query: { page?: number; pageSize?: number; widgetId?: string },
) {
  await ensureDashboardCommentable(dashboardId, query.widgetId);
  const viewer = currentUser();
  const canManage = await canManageComments();
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const conds = [eq(reportDashboardComments.dashboardId, dashboardId), isNull(reportDashboardComments.parentId)];
  if (query.widgetId) conds.push(eq(reportDashboardComments.widgetId, query.widgetId));
  const where = and(...conds);
  const [total, roots] = await Promise.all([
    db.$count(reportDashboardComments, where),
    db.query.reportDashboardComments.findMany({
      where,
      with: {
        user: { columns: { nickname: true, username: true, avatar: true } },
        resolvedByUser: { columns: { nickname: true, username: true } },
      },
      orderBy: desc(reportDashboardComments.id),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  ]);
  const rootIds = roots.map((row) => row.id);
  const replies = rootIds.length === 0 ? [] : await db.query.reportDashboardComments.findMany({
    where: and(
      eq(reportDashboardComments.dashboardId, dashboardId),
      inArray(reportDashboardComments.parentId, rootIds),
    ),
    with: {
      user: { columns: { nickname: true, username: true, avatar: true } },
      resolvedByUser: { columns: { nickname: true, username: true } },
    },
    orderBy: asc(reportDashboardComments.id),
  });
  const replyMap = new Map<number, ReportDashboardComment[]>();
  for (const row of replies) {
    const rendered = mapComment(row, viewer.userId, canManage);
    if (!commentVisibleTo(row, viewer.userId, canManage, false)) continue;
    const list = replyMap.get(row.parentId!) ?? [];
    list.push(rendered);
    replyMap.set(row.parentId!, list);
  }
  const list = roots.flatMap((row) => {
    const childList = replyMap.get(row.id) ?? [];
    if (!commentVisibleTo(row, viewer.userId, canManage, childList.length > 0)) return [];
    return [mapComment(row, viewer.userId, canManage, childList)];
  });
  return { list, total, page, pageSize };
}

export async function createComment(
  dashboardId: number,
  input: CreateReportCommentInput,
): Promise<ReportDashboardComment> {
  const dashboard = await ensureDashboardCommentable(dashboardId, input.widgetId);
  const user = currentUser();
  let parentId: number | null = null;
  if (input.parentId) {
    const parent = await ensureCommentExists(dashboardId, input.parentId);
    if (input.widgetId && parent.widgetId && parent.widgetId !== input.widgetId) {
      throw new HTTPException(400, { message: '回复评论的组件不匹配' });
    }
    parentId = normalizeParentId(parent);
  }
  const [row] = await db.insert(reportDashboardComments).values({
    dashboardId,
    widgetId: input.widgetId ?? null,
    parentId,
    content: input.content,
    userId: user.userId,
  }).returning();
  await notifyMentions(dashboard, input.content, user.userId);
  const full = await db.query.reportDashboardComments.findFirst({
    where: eq(reportDashboardComments.id, row.id),
    with: {
      user: { columns: { nickname: true, username: true, avatar: true } },
      resolvedByUser: { columns: { nickname: true, username: true } },
    },
  });
  return mapComment(full ?? row, user.userId, await canManageComments());
}

export async function updateComment(
  dashboardId: number,
  id: number,
  input: UpdateReportCommentInput,
): Promise<ReportDashboardComment> {
  const row = await ensureCommentExists(dashboardId, id);
  const user = currentUser();
  if (row.userId !== user.userId) throw new HTTPException(403, { message: '只能编辑自己的评论' });
  if (row.deletedAt) throw new HTTPException(400, { message: '已删除评论不能编辑' });
  const dashboard = await ensureDashboardCommentable(dashboardId, row.widgetId ?? undefined);
  const [updated] = await db.update(reportDashboardComments).set({ content: input.content }).where(eq(reportDashboardComments.id, id)).returning();
  if (!updated) throw new HTTPException(404, { message: '评论不存在' });
  await notifyMentions(dashboard, input.content, user.userId);
  const full = await db.query.reportDashboardComments.findFirst({
    where: eq(reportDashboardComments.id, id),
    with: {
      user: { columns: { nickname: true, username: true, avatar: true } },
      resolvedByUser: { columns: { nickname: true, username: true } },
    },
  });
  return mapComment(full ?? updated, user.userId, await canManageComments());
}

export async function deleteComment(dashboardId: number, id: number): Promise<void> {
  const row = await ensureCommentExists(dashboardId, id);
  const user = currentUser();
  const canManage = await canManageComments();
  if (row.userId !== user.userId && !canManage) throw new HTTPException(403, { message: '只能删除自己的评论' });
  await db.update(reportDashboardComments).set({
    deletedAt: new Date(),
    deletedBy: user.userId,
  }).where(eq(reportDashboardComments.id, id));
}

export async function resolveComment(
  dashboardId: number,
  id: number,
  input: ResolveReportCommentInput,
): Promise<ReportDashboardComment> {
  const row = await ensureCommentExists(dashboardId, id);
  const user = currentUser();
  const canManage = await canManageComments();
  if (row.userId !== user.userId && !canManage) {
    throw new HTTPException(403, { message: '只有评论作者或仪表盘编辑者可操作解决状态' });
  }
  const [updated] = await db.update(reportDashboardComments).set(input.resolved
    ? { resolvedAt: new Date(), resolvedBy: user.userId }
    : { resolvedAt: null, resolvedBy: null })
    .where(eq(reportDashboardComments.id, id))
    .returning();
  if (!updated) throw new HTTPException(404, { message: '评论不存在' });
  const full = await db.query.reportDashboardComments.findFirst({
    where: eq(reportDashboardComments.id, id),
    with: {
      user: { columns: { nickname: true, username: true, avatar: true } },
      resolvedByUser: { columns: { nickname: true, username: true } },
    },
  });
  return mapComment(full ?? updated, user.userId, canManage);
}
