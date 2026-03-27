import { http, HttpResponse } from 'msw';
import { mockOnlineSessions } from '@/mocks/data/system';

export const sessionsHandlers = [
  // 在线用户列表
  http.get('/api/sessions', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const username = url.searchParams.get('username') ?? '';

    let list = mockOnlineSessions.filter((s) => {
      if (username && !s.username.includes(username)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 强制下线（demo 模式仅从列表中移除）
  http.delete('/api/sessions/:tokenId', ({ params }) => {
    const index = mockOnlineSessions.findIndex((s) => s.tokenId === params.tokenId);
    if (index === -1) return HttpResponse.json({ code: 404, message: '会话不存在', data: null });
    mockOnlineSessions.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '已强制下线', data: null });
  }),
];
