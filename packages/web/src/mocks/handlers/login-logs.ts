import { http, HttpResponse } from 'msw';
import { mockLoginLogs } from '@/mocks/data/logs';

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
