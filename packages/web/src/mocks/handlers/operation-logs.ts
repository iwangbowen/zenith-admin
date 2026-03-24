import { http, HttpResponse } from 'msw';
import { mockOperationLogs } from '../data/logs';

export const operationLogsHandlers = [
  http.get('/api/operation-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const username = url.searchParams.get('username') ?? '';
    const module = url.searchParams.get('module') ?? '';

    let list = mockOperationLogs.filter((log) => {
      if (username && log.username && !log.username.includes(username)) return false;
      if (module && log.module && !log.module.includes(module)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),
];
