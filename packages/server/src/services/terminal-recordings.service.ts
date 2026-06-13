import { eq, and, desc, asc, ilike, gte, lte, lt, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { terminalRecordings, users, type RecordingEvent } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { escapeLike, withPagination } from '../lib/where-helpers';
import { getConfigNumber } from '../lib/system-config';

export interface CreateRecordingInput {
  title: string;
  shell: string | null;
  cols: number;
  rows: number;
  duration: number;
  events: RecordingEvent[];
}

type RecordingRow = {
  id: number; title: string; userId: number; shell: string | null;
  cols: number; rows: number; duration: number;
  createdAt: Date; updatedAt: Date;
  nickname?: string | null;
  sizeBytes?: number | string | null;
};

function mapRow(r: RecordingRow) {
  return {
    id: r.id,
    title: r.title,
    userId: r.userId,
    username: r.nickname ?? '',
    shell: r.shell,
    cols: r.cols,
    rows: r.rows,
    duration: r.duration,
    sizeBytes: Number(r.sizeBytes ?? 0),
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  };
}

/** events JSON 文本字节长度（用于容量统计与清理，动态计算，不落库）。 */
const sizeExpr = sql<number>`length(${terminalRecordings.events}::text)`;

/** 创建录屏记录。 */
export async function createRecording(userId: number, tenantId: number | null, input: CreateRecordingInput) {
  const [row] = await db
    .insert(terminalRecordings)
    .values({
      title: input.title,
      userId,
      tenantId,
      shell: input.shell,
      cols: input.cols,
      rows: input.rows,
      duration: input.duration,
      events: input.events,
    })
    .returning();
  return mapRow({ ...row, sizeBytes: Buffer.byteLength(JSON.stringify(row.events), 'utf8') });
}

export interface ListRecordingsParams {
  page: number;
  pageSize: number;
  keyword?: string;
  operatorUserId?: number;
  shell?: string;
  startDate?: Date;
  endDate?: Date;
}

/** 分页查询全局录屏列表（管理员审计，不返回 events 字段）。 */
export async function listRecordings(params: ListRecordingsParams) {
  const { page, pageSize, keyword, operatorUserId, shell, startDate, endDate } = params;
  const conditions = [];
  if (keyword) conditions.push(ilike(terminalRecordings.title, `%${escapeLike(keyword)}%`));
  if (operatorUserId) conditions.push(eq(terminalRecordings.userId, operatorUserId));
  if (shell) conditions.push(eq(terminalRecordings.shell, shell));
  if (startDate) conditions.push(gte(terminalRecordings.createdAt, startDate));
  if (endDate) conditions.push(lte(terminalRecordings.createdAt, endDate));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = db
    .select({
      id: terminalRecordings.id,
      title: terminalRecordings.title,
      userId: terminalRecordings.userId,
      nickname: users.nickname,
      shell: terminalRecordings.shell,
      cols: terminalRecordings.cols,
      rows: terminalRecordings.rows,
      duration: terminalRecordings.duration,
      sizeBytes: sizeExpr,
      createdAt: terminalRecordings.createdAt,
      updatedAt: terminalRecordings.updatedAt,
    })
    .from(terminalRecordings)
    .leftJoin(users, eq(terminalRecordings.userId, users.id))
    .where(where)
    .orderBy(desc(terminalRecordings.createdAt))
    .$dynamic();

  const [total, rows] = await Promise.all([
    db.$count(terminalRecordings, where),
    withPagination(baseQuery, page, pageSize),
  ]);
  return {
    total,
    list: rows.map((r) => mapRow({ ...r, nickname: r.nickname ?? null })),
    page,
    pageSize,
  };
}

/** 获取单条录屏详情（含 events）。管理员审计，可访问任意录屏。 */
export async function getRecording(id: number) {
  const [row] = await db
    .select({
      id: terminalRecordings.id,
      title: terminalRecordings.title,
      userId: terminalRecordings.userId,
      nickname: users.nickname,
      shell: terminalRecordings.shell,
      cols: terminalRecordings.cols,
      rows: terminalRecordings.rows,
      duration: terminalRecordings.duration,
      sizeBytes: sizeExpr,
      events: terminalRecordings.events,
      createdAt: terminalRecordings.createdAt,
      updatedAt: terminalRecordings.updatedAt,
    })
    .from(terminalRecordings)
    .leftJoin(users, eq(terminalRecordings.userId, users.id))
    .where(eq(terminalRecordings.id, id));
  if (!row) throw new HTTPException(404, { message: '录屏不存在' });
  return { ...mapRow({ ...row, nickname: row.nickname ?? null }), events: row.events };
}

/** 删除录屏。管理员审计，可删除任意录屏。 */
export async function deleteRecording(id: number) {
  const result = await db
    .delete(terminalRecordings)
    .where(eq(terminalRecordings.id, id));
  if ((result as { rowCount?: number }).rowCount === 0) {
    throw new HTTPException(404, { message: '录屏不存在' });
  }
}

/** 清除录屏记录。months=0 删除全部，否则删除 N 个月前的记录。 */
export async function cleanRecordings(months: number) {
  if (months === 0) {
    const result = await db.delete(terminalRecordings).returning({ id: terminalRecordings.id });
    return result.length;
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const result = await db
    .delete(terminalRecordings)
    .where(lt(terminalRecordings.createdAt, cutoff))
    .returning({ id: terminalRecordings.id });
  return result.length;
}

/** 全局录屏统计（管理员审计）。 */
export async function getRecordingStats() {
  const [summaryRows, byOperatorRows, byShellRows, trendRows, retainDays, maxSizeMb] = await Promise.all([
    db
      .select({
        totalCount: sql<number>`count(*)::int`,
        totalSizeBytes: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint`,
        totalDuration: sql<number>`coalesce(sum(${terminalRecordings.duration}), 0)`,
        avgDuration: sql<number>`coalesce(avg(${terminalRecordings.duration}), 0)`,
        earliestAt: sql<Date | null>`min(${terminalRecordings.createdAt})`,
        latestAt: sql<Date | null>`max(${terminalRecordings.createdAt})`,
      })
      .from(terminalRecordings),
    db
      .select({
        userId: terminalRecordings.userId,
        nickname: users.nickname,
        count: sql<number>`count(*)::int`,
        sizeBytes: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint`,
      })
      .from(terminalRecordings)
      .leftJoin(users, eq(terminalRecordings.userId, users.id))
      .groupBy(terminalRecordings.userId, users.nickname)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({
        shell: terminalRecordings.shell,
        count: sql<number>`count(*)::int`,
        sizeBytes: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint`,
      })
      .from(terminalRecordings)
      .groupBy(terminalRecordings.shell)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({
        date: sql<string>`to_char(${terminalRecordings.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        sizeBytes: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint`,
      })
      .from(terminalRecordings)
      .where(gte(terminalRecordings.createdAt, sql`now() - interval '30 days'`))
      .groupBy(sql`to_char(${terminalRecordings.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${terminalRecordings.createdAt}, 'YYYY-MM-DD')`),
    getConfigNumber('terminal_recording_retain_days', 30),
    getConfigNumber('terminal_recording_max_size_mb', 500),
  ]);

  const summary = summaryRows[0];
  const totalSizeBytes = Number(summary?.totalSizeBytes ?? 0);
  const maxBytes = maxSizeMb > 0 ? maxSizeMb * 1024 * 1024 : 0;
  return {
    totalCount: Number(summary?.totalCount ?? 0),
    totalSizeBytes,
    totalDuration: Number(summary?.totalDuration ?? 0),
    avgDuration: Number(summary?.avgDuration ?? 0),
    earliestAt: summary?.earliestAt ? formatDateTime(summary.earliestAt) : null,
    latestAt: summary?.latestAt ? formatDateTime(summary.latestAt) : null,
    byOperator: byOperatorRows.map((r) => ({
      userId: r.userId,
      username: r.nickname ?? '',
      count: Number(r.count),
      sizeBytes: Number(r.sizeBytes),
    })),
    byShell: byShellRows.map((r) => ({
      shell: r.shell,
      count: Number(r.count),
      sizeBytes: Number(r.sizeBytes),
    })),
    trend: trendRows.map((r) => ({
      date: r.date,
      count: Number(r.count),
      sizeBytes: Number(r.sizeBytes),
    })),
    retainDays,
    maxSizeMb,
    remainingBytes: maxBytes > 0 ? Math.max(0, maxBytes - totalSizeBytes) : 0,
  };
}

/** 根据系统配置（保留天数 / 容量上限，任一满足即清理）全局清理录屏。 */
export async function cleanupRecordings(): Promise<{
  deletedByAge: number;
  deletedBySize: number;
  freedBytes: number;
  remainingBytes: number;
}> {
  const retainDays = await getConfigNumber('terminal_recording_retain_days', 30);
  const maxSizeMb = await getConfigNumber('terminal_recording_max_size_mb', 500);
  let deletedByAge = 0;
  let deletedBySize = 0;
  let freedBytes = 0;

  // 1. 按保留天数清理
  if (retainDays > 0) {
    const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(terminalRecordings)
      .where(lt(terminalRecordings.createdAt, cutoff))
      .returning({ size: sizeExpr });
    deletedByAge = deleted.length;
    freedBytes += deleted.reduce((sum, d) => sum + Number(d.size), 0);
  }

  // 2. 按全局总容量上限清理（从最旧开始删，直到不超过上限）
  if (maxSizeMb > 0) {
    const maxBytes = maxSizeMb * 1024 * 1024;
    const [agg] = await db
      .select({ total: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint` })
      .from(terminalRecordings);
    let currentTotal = Number(agg?.total ?? 0);
    if (currentTotal > maxBytes) {
      const rows = await db
        .select({ id: terminalRecordings.id, size: sizeExpr })
        .from(terminalRecordings)
        .orderBy(asc(terminalRecordings.createdAt));
      const idsToDelete: number[] = [];
      for (const row of rows) {
        if (currentTotal <= maxBytes) break;
        idsToDelete.push(row.id);
        const sz = Number(row.size);
        currentTotal -= sz;
        freedBytes += sz;
      }
      if (idsToDelete.length > 0) {
        await db.delete(terminalRecordings).where(inArray(terminalRecordings.id, idsToDelete));
        deletedBySize = idsToDelete.length;
      }
    }
  }

  const [after] = await db
    .select({ total: sql<string>`coalesce(sum(length(${terminalRecordings.events}::text)), 0)::bigint` })
    .from(terminalRecordings);
  return { deletedByAge, deletedBySize, freedBytes, remainingBytes: Number(after?.total ?? 0) };
}
