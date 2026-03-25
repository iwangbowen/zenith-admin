import { http, HttpResponse } from 'msw';
import { mockOperationLogs } from '../data/logs';
import dayjs from 'dayjs';

const MOCK_MODULE_STATS = [
  { module: '用户管理', count: 142 },
  { module: '角色管理', count: 87 },
  { module: '系统配置', count: 65 },
  { module: '字典管理', count: 53 },
  { module: '菜单管理', count: 48 },
  { module: '部门管理', count: 39 },
  { module: '岗位管理', count: 31 },
  { module: '操作日志', count: 28 },
  { module: '文件管理', count: 22 },
  { module: '定时任务', count: 17 },
];

const MOCK_USER_STATS = [
  { username: 'admin', count: 310 },
  { username: 'operator', count: 156 },
  { username: 'manager', count: 98 },
  { username: 'viewer', count: 44 },
  { username: 'auditor', count: 28 },
];

function buildMockDailyStats(days: number): { date: string; count: number }[] {
  const today = dayjs().startOf('day');
  return Array.from({ length: days }, (_, i) => {
    const date = today.subtract(days - 1 - i, 'day').format('YYYY-MM-DD');
    // Simulate realistic traffic with weekday/weekend pattern and some noise
    const baseCount = i === days - 1 ? 12 : Math.floor(Math.random() * 40 + 5);
    return { date, count: baseCount };
  });
}

export const operationLogsHandlers = [
  http.get('/api/operation-logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const username = url.searchParams.get('username') ?? '';
    const module = url.searchParams.get('module') ?? '';
    const ip = url.searchParams.get('ip') ?? '';

    let list = mockOperationLogs.filter((log) => {
      if (username && log.username && !log.username.includes(username)) return false;
      if (module && log.module && !log.module.includes(module)) return false;
      if (ip && log.ip && !log.ip.includes(ip)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/operation-logs/stats', ({ request }) => {
    const url = new URL(request.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 7), 365);
    const scale = days / 30;

    const moduleStats = MOCK_MODULE_STATS.map((m) => ({
      module: m.module,
      count: Math.round(m.count * scale * (0.8 + Math.random() * 0.4)),
    })).sort((a, b) => b.count - a.count);

    const userStats = MOCK_USER_STATS.map((u) => ({
      username: u.username,
      count: Math.round(u.count * scale * (0.8 + Math.random() * 0.4)),
    })).sort((a, b) => b.count - a.count);

    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        moduleStats,
        dailyStats: buildMockDailyStats(days),
        userStats,
      },
    });
  }),
];
