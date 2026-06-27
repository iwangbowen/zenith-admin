/**
 * 报表仪表盘评论 Service —— 协作批注（整盘或组件级）。
 */
import { HTTPException } from 'hono/http-exception';
import { desc, eq } from 'drizzle-orm';
import { SUPER_ADMIN_CODE } from '@zenith/shared';
import { db } from '../db';
import { reportDashboardComments } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { currentUser } from '../lib/context';
import { ensureDashboardExists } from './report-dashboard.service';
import type { ReportDashboardCommentRow } from '../db/schema';
import type { ReportDashboardComment, CreateReportCommentInput } from '@zenith/shared';

type CommentRowExt = ReportDashboardCommentRow & { user?: { nickname: string | null; username: string; avatar: string | null } | null };

export function mapComment(row: CommentRowExt): ReportDashboardComment {
  return {
    id: row.id,
    dashboardId: row.dashboardId,
    widgetId: row.widgetId ?? null,
    content: row.content,
    userId: row.userId,
    userName: row.user?.nickname || row.user?.username || null,
    userAvatar: row.user?.avatar ?? null,
    createdAt: formatDateTime(row.createdAt),
  };
}

export async function listComments(dashboardId: number): Promise<ReportDashboardComment[]> {
  const rows = await db.query.reportDashboardComments.findMany({
    where: eq(reportDashboardComments.dashboardId, dashboardId),
    with: { user: { columns: { nickname: true, username: true, avatar: true } } },
    orderBy: desc(reportDashboardComments.id),
    limit: 200,
  });
  return rows.map(mapComment);
}

export async function createComment(dashboardId: number, input: CreateReportCommentInput): Promise<ReportDashboardComment> {
  await ensureDashboardExists(dashboardId);
  const user = currentUser();
  const [row] = await db.insert(reportDashboardComments).values({
    dashboardId,
    widgetId: input.widgetId ?? null,
    content: input.content,
    userId: user.userId,
  }).returning();
  const full = await db.query.reportDashboardComments.findFirst({
    where: eq(reportDashboardComments.id, row.id),
    with: { user: { columns: { nickname: true, username: true, avatar: true } } },
  });
  return mapComment(full ?? row);
}

export async function deleteComment(dashboardId: number, id: number): Promise<void> {
  const [row] = await db.select().from(reportDashboardComments).where(eq(reportDashboardComments.id, id)).limit(1);
  if (!row || row.dashboardId !== dashboardId) throw new HTTPException(404, { message: '评论不存在' });
  const user = currentUser();
  // 仅作者可删（超管放行由路由 guard 控制）
  if (row.userId !== user.userId && !user.roles.includes(SUPER_ADMIN_CODE)) {
    throw new HTTPException(403, { message: '只能删除自己的评论' });
  }
  await db.delete(reportDashboardComments).where(eq(reportDashboardComments.id, id));
}
