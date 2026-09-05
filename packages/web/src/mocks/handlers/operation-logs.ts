import { analyticsContract } from '@zenith/shared/analytics';
import { operationLogContract } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { removeWhere } from '@/mocks/utils/array';
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

const MOCK_SLOW_PATHS = [
  { path: '/api/reports/export', avgMs: 1240, maxMs: 4820 },
  { path: analyticsContract.overview.fullPath, avgMs: 860, maxMs: 2410 },
  { path: '/api/files/upload', avgMs: 640, maxMs: 3150 },
  { path: '/api/users', avgMs: 320, maxMs: 980 },
  { path: '/api/operation-logs', avgMs: 210, maxMs: 720 },
  { path: '/api/roles', avgMs: 150, maxMs: 430 },
  { path: '/api/menus', avgMs: 120, maxMs: 380 },
  { path: '/api/dicts', avgMs: 95, maxMs: 260 },
  { path: '/api/configs', avgMs: 80, maxMs: 210 },
  { path: '/api/departments', avgMs: 60, maxMs: 150 },
];

function buildMockDailyStats(days: number): { date: string; count: number; successCount: number; failCount: number; avgMs: number | null }[] {
  const today = dayjs().startOf('day');
  return Array.from({ length: days }, (_, i) => {
    const date = mockDate(today.subtract(days - 1 - i, 'day').valueOf());
    const total = i === days - 1 ? 12 : Math.floor(Math.random() * 40 + 5);
    const failCount = Math.floor(total * (0.02 + Math.random() * 0.06));
    return { date, count: total, successCount: total - failCount, failCount, avgMs: Math.round(60 + Math.random() * 180) };
  });
}

export const operationLogsHandlers = [
  mock(operationLogContract.list, ({ query, ok, paginate }) => {
    const username = query.username ?? '';
    const module = query.module ?? '';
    const ip = query.ip ?? '';
    const content = (query.content ?? '').toLowerCase();
    const minDurationMs = query.minDurationMs ?? null;
    const maxDurationMs = query.maxDurationMs ?? null;

    const list = mockOperationLogs.filter((log) => {
      if (username && log.username && !log.username.includes(username)) return false;
      if (module && log.module && !log.module.includes(module)) return false;
      if (ip && log.ip && !log.ip.includes(ip)) return false;
      if (content && !(
        log.beforeData?.toLowerCase().includes(content)
        || log.afterData?.toLowerCase().includes(content)
        || log.requestBody?.toLowerCase().includes(content)
      )) return false;
      if (minDurationMs !== null && (log.durationMs === null || log.durationMs < minDurationMs)) return false;
      if (maxDurationMs !== null && (log.durationMs === null || log.durationMs > maxDurationMs)) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  mock(operationLogContract.stats, ({ query, ok }) => {
    const days = Math.min(Math.max(query.days || 30, 7), 365);
    const scale = days / 30;

    const moduleStats = MOCK_MODULE_STATS.map((m) => ({
      module: m.module,
      count: Math.round(m.count * scale * (0.8 + Math.random() * 0.4)),
    })).sort((a, b) => b.count - a.count);

    const moduleTimingStats = MOCK_MODULE_STATS.map((m) => {
      const avgMs = Math.round(40 + Math.random() * 200);
      return {
        module: m.module,
        avgMs,
        maxMs: Math.round(avgMs * (1.5 + Math.random() * 2)),
        count: Math.round(m.count * scale * (0.8 + Math.random() * 0.4)),
      };
    }).sort((a, b) => b.avgMs - a.avgMs).slice(0, 10);

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
    const avgDurationMs = Math.round(80 + Math.random() * 120);
    // 上一周期按当前周期 8-11 折波动模拟
    const prevScale = 0.8 + Math.random() * 0.3;

    const statusClassStats = [
      { statusClass: '2xx', count: successCount },
      { statusClass: '3xx', count: Math.round(total * 0.02) },
      { statusClass: '4xx', count: Math.max(failCount - Math.round(total * 0.01), 0) },
      { statusClass: '5xx', count: Math.round(total * 0.01) },
    ].filter((s) => s.count > 0);

    const durationHistogram = [
      { bucket: '<100ms', count: Math.round(total * 0.55) },
      { bucket: '100-500ms', count: Math.round(total * 0.3) },
      { bucket: '0.5-1s', count: Math.round(total * 0.09) },
      { bucket: '1-3s', count: Math.round(total * 0.045) },
      { bucket: '>3s', count: Math.round(total * 0.015) },
    ];

    const slowPaths = MOCK_SLOW_PATHS.map((p) => ({
      ...p,
      count: Math.round(20 * scale * (0.6 + Math.random() * 0.8)) + 1,
    }));

    const failModuleStats = moduleStats.slice(0, 6).map((m) => ({
      module: m.module,
      count: Math.max(1, Math.round(m.count * 0.05 * (0.5 + Math.random()))),
    })).sort((a, b) => b.count - a.count);

    // 用户 × 模块交叉流向：按双方权重派生
    const userModuleFlows = userStats.flatMap((u) =>
      moduleStats.slice(0, 6).map((m) => ({
        username: u.username,
        module: m.module,
        count: Math.round((u.count * m.count) / Math.max(total, 1)) + 1,
      })),
    );

    return ok({
      summary: {
        total,
        successCount,
        failCount,
        avgDurationMs,
        uniqueUsers: 5,
        p50DurationMs: Math.round(avgDurationMs * 0.7),
        p95DurationMs: Math.round(avgDurationMs * 3.2),
        p99DurationMs: Math.round(avgDurationMs * 7.5),
      },
      prevSummary: {
        total: Math.round(total * prevScale),
        successCount: Math.round(successCount * prevScale),
        failCount: Math.round(failCount * prevScale),
        avgDurationMs: Math.round(avgDurationMs * (0.9 + Math.random() * 0.2)),
        uniqueUsers: 4,
      },
      moduleStats,
      moduleTimingStats,
      dailyStats,
      userStats,
      methodStats,
      hourlyStats,
      statusClassStats,
      durationHistogram,
      slowPaths,
      failModuleStats,
      userModuleFlows,
    });
  }),

  mock(operationLogContract.clean, ({ query, ok }) => {
    const cutoff = new Date(Date.now() - (query.days ?? 180) * 24 * 3600 * 1000);
    const deleted = removeWhere(
      mockOperationLogs,
      (log) => new Date(log.createdAt) < cutoff,
    );
    return ok(null, `共删除 ${deleted} 条操作日志`);
  }),
];
