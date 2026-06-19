/**
 * Web 终端会话注册表（进程内单例）
 *
 * 集中维护所有活动终端会话（本地 PTY / SSH / Docker exec）的运行态与元数据，
 * 供三方消费：
 *  - ws-terminal 路由：注册/路由 I/O、断线保活、销毁
 *  - ws-terminal-monitor 路由：管理员实时旁观（observer）与接管输入
 *  - terminal-sessions 服务：列出活动会话、强制终止
 *
 * 仅在单 Node 进程内有效（与现有 ptySessions 行为一致）。
 */

/** 抽象终端进程接口，兼容本地 PTY 和 SSH 两种后端 */
export interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** 客户端连接（终端使用者） */
export interface ClientConn {
  send: (data: string) => void;
  close: (code: number, reason: string) => void;
}

/** 观察者连接（管理员监控端） */
export interface ObserverConn {
  send: (data: string) => void;
}

export type TerminalKind = 'local' | 'ssh' | 'docker';

export interface TerminalSession {
  sessionId: string;
  process: TerminalProcess;
  /** 当前连接的客户端 WebSocket（无连接时为 null） */
  currentWs: ClientConn | null;
  /** 近期输出缓冲，断线重连 / 监控接入后回放 */
  outputBuffer: string;
  /** 进程保活计时器 */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** 会话归属用户，防止越权重连 */
  userId: number;
  username: string;
  kind: TerminalKind;
  /** 展示标签：本地为 shell 名，SSH 为 user@host，Docker 为容器名 */
  label: string;
  clientIp: string;
  startedAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  /** 管理员实时监控连接集合 */
  observers: Set<ObserverConn>;
  /** 正在接管输入的管理员用户 ID（null 表示无人接管） */
  takenOverBy: number | null;
}

/** PTY 会话的输出缓冲区上限（字节） */
export const OUTPUT_BUFFER_MAX = 50 * 1024;

const sessions = new Map<string, TerminalSession>();

export function getSession(sessionId: string): TerminalSession | undefined {
  return sessions.get(sessionId);
}

export function hasSession(sessionId: string): boolean {
  return sessions.has(sessionId);
}

export function setSession(sessionId: string, session: TerminalSession): void {
  sessions.set(sessionId, session);
}

export function clearIdleTimer(session: TerminalSession): void {
  if (session.idleTimer !== null) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
}

/** 向所有观察者广播一条 JSON 消息 */
function broadcastToObservers(session: TerminalSession, message: unknown): void {
  if (session.observers.size === 0) return;
  const text = JSON.stringify(message);
  for (const obs of session.observers) {
    try { obs.send(text); } catch { /* ignore broken observer */ }
  }
}

/** 追加输出到缓冲区，并镜像给所有观察者 */
export function appendOutput(session: TerminalSession, data: string): void {
  session.outputBuffer += data;
  if (session.outputBuffer.length > OUTPUT_BUFFER_MAX) {
    session.outputBuffer = session.outputBuffer.slice(-OUTPUT_BUFFER_MAX);
  }
  session.lastActivityAt = Date.now();
  broadcastToObservers(session, { type: 'terminal:output', data });
}

/** 记录一次输入活动（更新最近活跃时间） */
export function touchActivity(session: TerminalSession): void {
  session.lastActivityAt = Date.now();
}

/** 更新会话终端尺寸 */
export function setSize(session: TerminalSession, cols: number, rows: number): void {
  session.cols = cols;
  session.rows = rows;
}

/** 销毁会话：杀进程、清计时器、通知观察者、移除登记 */
export function destroySession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  clearIdleTimer(s);
  broadcastToObservers(s, { type: 'terminal:ended' });
  try { s.process.kill(); } catch { /* ignore */ }
  sessions.delete(sessionId);
}

// ─── 监控 / 接管 API ────────────────────────────────────────────────────────

/** 附加一个观察者，返回当前输出缓冲用于回放（会话不存在返回 null） */
export function attachObserver(sessionId: string, observer: ObserverConn): string | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.observers.add(observer);
  return s.outputBuffer;
}

/** 移除一个观察者 */
export function detachObserver(sessionId: string, observer: ObserverConn): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.observers.delete(observer);
  if (s.takenOverBy !== null && s.observers.size === 0) {
    s.takenOverBy = null;
  }
}

/** 管理员向会话注入输入（接管）。返回是否成功。 */
export function writeToSession(sessionId: string, data: string, adminUserId: number): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  s.takenOverBy = adminUserId;
  s.lastActivityAt = Date.now();
  try {
    s.process.write(data);
    return true;
  } catch {
    return false;
  }
}

/** 强制终止会话：通知客户端与观察者后销毁。返回是否存在该会话。 */
export function terminateSession(sessionId: string): boolean {
  const s = sessions.get(sessionId);
  if (!s) return false;
  try {
    s.currentWs?.send(JSON.stringify({ type: 'terminal:terminated', message: '会话已被管理员强制终止' }));
    s.currentWs?.close(1000, '管理员强制终止');
  } catch { /* ignore */ }
  destroySession(sessionId);
  return true;
}

export interface TerminalSessionMeta {
  sessionId: string;
  userId: number;
  username: string;
  kind: TerminalKind;
  label: string;
  clientIp: string;
  startedAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  connected: boolean;
  observerCount: number;
  takenOver: boolean;
}

function toMeta(s: TerminalSession): TerminalSessionMeta {
  return {
    sessionId: s.sessionId,
    userId: s.userId,
    username: s.username,
    kind: s.kind,
    label: s.label,
    clientIp: s.clientIp,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    cols: s.cols,
    rows: s.rows,
    connected: s.currentWs !== null,
    observerCount: s.observers.size,
    takenOver: s.takenOverBy !== null,
  };
}

/** 列出全部活动会话的元数据（按开始时间倒序） */
export function listSessionsMeta(): TerminalSessionMeta[] {
  return [...sessions.values()].map(toMeta).sort((a, b) => b.startedAt - a.startedAt);
}

export function getSessionMeta(sessionId: string): TerminalSessionMeta | null {
  const s = sessions.get(sessionId);
  return s ? toMeta(s) : null;
}
