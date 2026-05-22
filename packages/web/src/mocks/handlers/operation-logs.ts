import { http, HttpResponse } from 'msw';
import { mockOperationLogs } from '@/mocks/data/logs';
import { mockDate } from '@/mocks/utils/date';
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

const MOCK_METHOD_STATS = [
  { method: 'GET', count: 480 },
  { method: 'POST', count: 210 },
  { method: 'PUT', count: 95 },
  { method: 'DELETE', count: 48 },
  { method: 'PATCH', count: 22 },
];

// Simulate realistic hourly traffic (night low, morning spike, noon drop, afternoon high)
const MOCK_HOURLY_BASE = [1,1,0,0,1,2,5,18,32,38,35,28,22,30,36,40,38,34,28,20,14,9,5,3];

function buildMockDailyStats(days: number): { date: string; count: number; successCount: number; failCount: number }[] {
  const today = dayjs().startOf('day');
  return Array.from({ length: days }, (_, i) => {
    const date = mockDate(today.subtract(days - 1 - i, 'day').valueOf());
    const total = i === days - 1 ? 12 : Math.floor(Math.random() * 40 + 5);
    const failCount = Math.floor(total * (0.02 + Math.random() * 0.06));
    return { date, count: total, successCount: total - failCount, failCount };
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

    const methodStats = MOCK_METHOD_STATS.map((m) => ({
      method: m.method,
      count: Math.round(m.count * scale * (0.8 + Math.random() * 0.4)),
    }));

    const hourlyStats = MOCK_HOURLY_BASE.map((base, hour) => ({
      hour,
      count: Math.round(base * scale * (0.7 + Math.random() * 0.6)),
    }));

    const dailyStats = buildMockDailyStats(days);
    const total = dailyStats.reduce((s, d) => s + d.count, 0);
    const successCount = dailyStats.reduce((s, d) => s + d.successCount, 0);
    const failCount = dailyStats.reduce((s, d) => s + d.failCount, 0);

    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        summary: {
          total,
          successCount,
          failCount,
          avgDurationMs: Math.round(80 + Math.random() * 120),
          uniqueUsers: 5,
        },
        moduleStats,
        dailyStats,
        userStats,
        methodStats,
        hourlyStats,
      },
    });
  }),
];
