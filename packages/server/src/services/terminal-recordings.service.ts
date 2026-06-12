import { eq, and, desc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { terminalRecordings, users, type RecordingEvent } from '../db/schema';
import { formatDateTime } from '../lib/datetime';

export interface CreateRecordingInput {
  title: string;
  shell: string | null;
  cols: number;
  rows: number;
  duration: number;
  events: RecordingEvent[];
}

function mapRecording(r: typeof terminalRecordings.$inferSelect & { nickname: string | null }) {
  return {
    id: r.id,
    title: r.title,
    userId: r.userId,
    username: r.nickname ?? '',
    shell: r.shell,
    cols: r.cols,
    rows: r.rows,
    duration: r.duration,
    createdAt: formatDateTime(r.createdAt),
    updatedAt: formatDateTime(r.updatedAt),
  };
}

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
  return mapRecording(row);
}

/** 分页查询当前用户的录屏列表（不返回 events 字段）。 */
export async function listRecordings(userId: number, page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  const where = eq(terminalRecordings.userId, userId);
  const [total, rows] = await Promise.all([
    db.$count(terminalRecordings, where),
    db
      .select({
        id: terminalRecordings.id,
        title: terminalRecordings.title,
        userId: terminalRecordings.userId,
        shell: terminalRecordings.shell,
        cols: terminalRecordings.cols,
        rows: terminalRecordings.rows,
        duration: terminalRecordings.duration,
        createdAt: terminalRecordings.createdAt,
        updatedAt: terminalRecordings.updatedAt,
      })      .from(terminalRecordings)
      .where(where)
      .orderBy(desc(terminalRecordings.createdAt))
      .limit(pageSize)
      .offset(offset),
  ]);
  return {
    total,
    list: rows.map(mapRecording),
    page,
    pageSize,
  };
}

/** 获取单条录屏详情（含 events）。仅允许访问自己的录屏。 */
export async function getRecording(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(terminalRecordings)
    .leftJoin(users, eq(terminalRecordings.userId, users.id))
    .where(and(eq(terminalRecordings.id, id), eq(terminalRecordings.userId, userId)));
  if (!row) throw new HTTPException(404, { message: '录屏不存在' });
  const rec = row.terminal_recordings;
  const nickname = row.users?.nickname ?? '';
  return { ...mapRecording({ ...rec, nickname }), events: rec.events };
}

/** 删除录屏。仅允许删除自己的录屏。 */
export async function deleteRecording(id: number, userId: number) {
  const result = await db
    .delete(terminalRecordings)
    .where(and(eq(terminalRecordings.id, id), eq(terminalRecordings.userId, userId)));
  if ((result as { rowCount?: number }).rowCount === 0) {
    throw new HTTPException(404, { message: '录屏不存在或无权删除' });
  }
}
