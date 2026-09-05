import { terminalSessionContract, type TerminalSession } from '@zenith/shared/ops';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTimeOffset } from '@/mocks/utils/date';

const mockTerminalSessions: TerminalSession[] = [
  {
    sessionId: 'tab-1-demo', userId: 1, username: 'admin', kind: 'local', label: 'Bash',
    clientIp: '192.168.1.10', cols: 120, rows: 32, connected: true, observerCount: 0, takenOver: false,
    startedAt: mockDateTimeOffset(-1000 * 60 * 18), lastActivityAt: mockDateTimeOffset(-1000 * 12),
    idleSeconds: 12, durationSeconds: 1080,
  },
  {
    sessionId: 'tab-2-demo', userId: 2, username: 'ops', kind: 'ssh', label: 'root@10.0.0.5:22',
    clientIp: '192.168.1.22', cols: 80, rows: 24, connected: true, observerCount: 1, takenOver: false,
    startedAt: mockDateTimeOffset(-1000 * 60 * 42), lastActivityAt: mockDateTimeOffset(-1000 * 60 * 3),
    idleSeconds: 180, durationSeconds: 2520,
  },
  {
    sessionId: 'tab-3-demo', userId: 2, username: 'ops', kind: 'docker', label: 'docker:web-1',
    clientIp: '192.168.1.22', cols: 100, rows: 28, connected: false, observerCount: 0, takenOver: false,
    startedAt: mockDateTimeOffset(-1000 * 60 * 60), lastActivityAt: mockDateTimeOffset(-1000 * 60 * 9),
    idleSeconds: 540, durationSeconds: 3600,
  },
];

export const terminalSessionsHandlers = [
  // 活动终端会话列表
  mock(terminalSessionContract.list, ({ query, ok, paginate }) => {
    const keyword = (query.keyword ?? '').toLowerCase();
    const list = mockTerminalSessions.filter((s) => {
      if (query.kind && s.kind !== query.kind) return false;
      if (keyword && !(s.username.toLowerCase().includes(keyword) || s.label.toLowerCase().includes(keyword) || s.clientIp.includes(keyword))) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 强制终止（demo 模式仅从列表中移除）
  mock(terminalSessionContract.terminate, ({ params, ok }) => {
    const idx = mockTerminalSessions.findIndex((s) => s.sessionId === params.sessionId);
    if (idx === -1) return notFound('会话不存在或已结束');
    mockTerminalSessions.splice(idx, 1);
    return ok(null, '已终止');
  }),
];
