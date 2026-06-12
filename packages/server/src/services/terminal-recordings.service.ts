import { eq, and, desc, ilike } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { terminalRecordings, users, type RecordingEvent } from '../db/schema';
import { formatDateTime } from '../lib/datetime';
import { escapeLike, withPagination } from '../lib/where-helpers';

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
export async function listRecordings(userId: number, page: number, pageSize: number, keyword?: string) {
  const conditions = [eq(terminalRecordings.userId, userId)];
  if (keyword) conditions.push(ilike(terminalRecordings.title, `%${escapeLike(keyword)}%`));
  const where = and(...conditions);

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
    list: rows.map((r) => mapRecording({ ...r, nickname: r.nickname ?? null })),
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
