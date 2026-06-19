import { http, HttpResponse } from 'msw';
import { mockDateTimeOffset } from '@/mocks/utils/date';

type Kind = 'local' | 'ssh' | 'docker';

interface MockTerminalSession {
  sessionId: string;
  userId: number;
  username: string;
  kind: Kind;
  label: string;
  clientIp: string;
  cols: number;
  rows: number;
  connected: boolean;
  observerCount: number;
  takenOver: boolean;
  startedAt: string;
  lastActivityAt: string;
  idleSeconds: number;
  durationSeconds: number;
}

const mockTerminalSessions: MockTerminalSession[] = [
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
  http.get('/api/terminal-sessions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = (url.searchParams.get('keyword') ?? '').toLowerCase();
    const kind = url.searchParams.get('kind') ?? '';

    let list = mockTerminalSessions.filter((s) => {
      if (kind && s.kind !== kind) return false;
      if (keyword && !(s.username.toLowerCase().includes(keyword) || s.label.toLowerCase().includes(keyword) || s.clientIp.includes(keyword))) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 强制终止（demo 模式仅从列表中移除）
  http.post('/api/terminal-sessions/:sessionId/terminate', ({ params }) => {
    const idx = mockTerminalSessions.findIndex((s) => s.sessionId === params.sessionId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '会话不存在或已结束', data: null });
    mockTerminalSessions.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '已终止', data: null });
  }),
];
