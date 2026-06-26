/**
 * 报表仪表盘 Service
 * CRUD —— 布局（react-grid-layout）与组件配置以 jsonb 存储。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { reportDashboards } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { ReportDashboardRow } from '../db/schema';
import type {
  ReportDashboard, ReportGridItem, ReportWidget,
  CreateReportDashboardInput, UpdateReportDashboardInput,
} from '@zenith/shared';

export function mapDashboard(row: ReportDashboardRow): ReportDashboard {
  return {
    id: row.id,
    name: row.name,
    layout: (row.layout ?? []) as ReportGridItem[],
    widgets: (row.widgets ?? []) as ReportWidget[],
    status: row.status,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureDashboardExists(id: number): Promise<ReportDashboardRow> {
  const [row] = await db.select().from(reportDashboards).where(eq(reportDashboards.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
  return row;
}

export async function getDashboard(id: number): Promise<ReportDashboard> {
  return mapDashboard(await ensureDashboardExists(id));
}

export async function listDashboards(query: {
  page?: number; pageSize?: number; keyword?: string; status?: string;
}) {
  const { page = 1, pageSize = 20, keyword, status } = query;
  const conds = [];
  if (keyword) {
    const kw = `%${escapeLike(keyword)}%`;
    conds.push(or(ilike(reportDashboards.name, kw), ilike(reportDashboards.remark, kw)));
  }
  if (status === 'enabled' || status === 'disabled') conds.push(eq(reportDashboards.status, status));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDashboards, where),
    db.select().from(reportDashboards).where(where)
      .orderBy(desc(reportDashboards.id)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(mapDashboard), total, page, pageSize };
}

export async function createDashboard(input: CreateReportDashboardInput): Promise<ReportDashboard> {
  try {
    const [row] = await db.insert(reportDashboards).values({
      name: input.name,
      layout: (input.layout ?? []) as ReportGridItem[],
      widgets: (input.widgets ?? []) as ReportWidget[],
      status: input.status ?? 'enabled',
      remark: input.remark,
    }).returning();
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '仪表盘名称已存在');
    throw err;
  }
}

export async function updateDashboard(id: number, input: UpdateReportDashboardInput): Promise<ReportDashboard> {
  try {
    const [row] = await db.update(reportDashboards).set({
      name: input.name,
      layout: input.layout as ReportGridItem[] | undefined,
      widgets: input.widgets as ReportWidget[] | undefined,
      status: input.status,
      remark: input.remark,
    }).where(eq(reportDashboards.id, id)).returning();
    if (!row) throw new HTTPException(404, { message: '仪表盘不存在' });
    return mapDashboard(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '仪表盘名称已存在');
    throw err;
  }
}

export async function deleteDashboard(id: number): Promise<void> {
  await ensureDashboardExists(id);
  await db.delete(reportDashboards).where(eq(reportDashboards.id, id));
}
