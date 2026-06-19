import { HTTPException } from 'hono/http-exception';
import {
  listSessionsMeta,
  getSessionMeta,
  terminateSession,
  type TerminalSessionMeta,
  type TerminalKind,
} from '../lib/terminal-session-registry';
import { pageOffset } from '../lib/pagination';
import { formatDateTime } from '../lib/datetime';

/** 将注册表元数据映射为对外 DTO（含派生的空闲/持续时长） */
function mapMeta(m: TerminalSessionMeta) {
  const now = Date.now();
  return {
    sessionId: m.sessionId,
    userId: m.userId,
    username: m.username,
    kind: m.kind,
    label: m.label,
    clientIp: m.clientIp,
    cols: m.cols,
    rows: m.rows,
    connected: m.connected,
    observerCount: m.observerCount,
    takenOver: m.takenOver,
    startedAt: formatDateTime(new Date(m.startedAt)),
    lastActivityAt: formatDateTime(new Date(m.lastActivityAt)),
    idleSeconds: Math.max(0, Math.floor((now - m.lastActivityAt) / 1000)),
    durationSeconds: Math.max(0, Math.floor((now - m.startedAt) / 1000)),
  };
}

export interface ListTerminalSessionsParams {
  page: number;
  pageSize: number;
  keyword?: string;
  kind?: TerminalKind;
}

/** 分页列出活动终端会话（内存注册表，进程内分页）。 */
export function listTerminalSessions(params: ListTerminalSessionsParams) {
  const { page, pageSize, keyword, kind } = params;
  let all = listSessionsMeta();
  if (kind) all = all.filter((s) => s.kind === kind);
  if (keyword) {
    const kw = keyword.toLowerCase();
    all = all.filter(
      (s) => s.username.toLowerCase().includes(kw) || s.label.toLowerCase().includes(kw) || s.clientIp.includes(kw),
    );
  }
  const total = all.length;
  const list = all.slice(pageOffset(page, pageSize), page * pageSize).map(mapMeta);
  return { list, total, page, pageSize };
}

/** 获取单个会话快照（用于强制终止前的审计记录）。 */
export function getTerminalSessionSnapshot(sessionId: string) {
  const m = getSessionMeta(sessionId);
  return m ? mapMeta(m) : null;
}

/** 强制终止指定会话。 */
export function terminateTerminalSession(sessionId: string): void {
  const ok = terminateSession(sessionId);
  if (!ok) throw new HTTPException(404, { message: '会话不存在或已结束' });
}
