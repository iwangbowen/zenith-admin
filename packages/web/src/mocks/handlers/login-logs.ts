import { http, HttpResponse } from 'msw';
import { mockLoginLogs } from '@/mocks/data/logs';

/** 从登录日志派生统计数据，避免硬编码与列表数据脱节 */
function buildLoginLogStats(days: number) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const toTime = (s: string) => new Date(s.replace(' ', 'T')).getTime();
  const logs = mockLoginLogs.filter((l) => toTime(l.createdAt) >= cutoff);

  const successCount = logs.filter((l) => l.status === 'success').length;
  const failCount = logs.length - successCount;
  const uniqueUsers = new Set(logs.map((l) => l.username)).size;

  const countBy = <T,>(arr: T[], keyFn: (x: T) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const x of arr) {
      const k = keyFn(x);
      if (k == null) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };

  const dailyMap = new Map<string, { date: string; count: number; successCount: number; failCount: number }>();
  for (const l of logs) {
    const date = l.createdAt.slice(0, 10);
    const d = dailyMap.get(date) ?? { date, count: 0, successCount: 0, failCount: 0 };
    d.count++;
    if (l.status === 'success') d.successCount++;
    else d.failCount++;
    dailyMap.set(date, d);
  }
  const dailyStats = [...dailyMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  const hourMap = new Map<number, number>();
  for (const l of logs) {
    const hour = Number(l.createdAt.slice(11, 13)) || 0;
    hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
  }
  const hourlyStats = [...hourMap.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);

  return {
    summary: { total: logs.length, successCount, failCount, uniqueUsers },
    dailyStats,
    userStats: countBy(logs, (l) => l.username).slice(0, 10).map((x) => ({ username: x.key, count: x.count })),
    ipStats: countBy(logs, (l) => l.ip).slice(0, 10).map((x) => ({ ip: x.key, count: x.count })),
    ipFailStats: countBy(logs.filter((l) => l.status === 'fail'), (l) => l.ip).slice(0, 10).map((x) => ({ ip: x.key, count: x.count })),
    browserStats: countBy(logs, (l) => l.browser).map((x) => ({ browser: x.key, count: x.count })),
    osStats: countBy(logs, (l) => l.os).map((x) => ({ os: x.key, count: x.count })),
    hourlyStats,
  };
}

export const loginLogsHandlers = [
  http.get('/api/login-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const username = url.searchParams.get('username') ?? '';
    const status = url.searchParams.get('status') ?? '';

    let list = mockLoginLogs.filter((log) => {
      if (username && !log.username.includes(username)) return false;
      if (status && log.status !== status) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 登录日志统计（页面加载时自动拉取，缺失会导致 401 → 跳转登录页）
  http.get('/api/login-logs/stats', ({ request }) => {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get('days')) || 30;
    return HttpResponse.json({ code: 0, message: 'ok', data: buildLoginLogStats(days) });
  }),

  // 导出 Excel
  http.get('/api/login-logs/export', () =>
    new HttpResponse(new Blob(['mock-excel-data']), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="login-logs.xlsx"',
      },
    }),
  ),

  // 导出 CSV
  http.get('/api/login-logs/export/csv', () =>
    new HttpResponse('\uFEFF用户名,IP,状态,时间\nadmin,127.0.0.1,成功,2026-06-20 12:00:00\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="login-logs.csv"',
      },
    }),
  ),

  http.delete('/api/login-logs/clean', ({ request }) => {
    const url = new URL(request.url);
    const months = Number(url.searchParams.get('months')) || 0;
    const cutoff = months === 0 ? null : new Date(Date.now() - months * 30 * 24 * 3600 * 1000);
    let deleted = 0;
    for (let i = mockLoginLogs.length - 1; i >= 0; i--) {
      if (cutoff === null || new Date(mockLoginLogs[i].createdAt) < cutoff) {
        mockLoginLogs.splice(i, 1);
        deleted++;
      }
    }
    return HttpResponse.json({ code: 0, message: `共删除 ${deleted} 条登录日志`, data: null });
  }),
];
