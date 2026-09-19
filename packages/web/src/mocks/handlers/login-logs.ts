import { loginLogContract } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { removeWhere } from '@/mocks/utils/array';
import { mockLoginLogs } from '@/mocks/data/logs';

/** 从登录日志派生统计数据，避免硬编码与列表数据脱节 */
function buildLoginLogStats(days: number) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const prevCutoff = cutoff - days * 24 * 3600 * 1000;
  const toTime = (s: string) => new Date(s.replace(' ', 'T')).getTime();
  const loginLogs = mockLoginLogs.filter((l) => (l.eventType ?? 'login') === 'login');
  const logs = loginLogs.filter((l) => toTime(l.createdAt) >= cutoff);
  const prevLogs = loginLogs.filter((l) => {
    const t = toTime(l.createdAt);
    return t >= prevCutoff && t < cutoff;
  });

  const summarize = (list: typeof logs) => {
    const successCount = list.filter((l) => l.status === 'success').length;
    return {
      total: list.length,
      successCount,
      failCount: list.length - successCount,
      uniqueUsers: new Set(list.map((l) => l.username)).size,
    };
  };

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
  const dowHourMap = new Map<string, number>();
  for (const l of logs) {
    const hour = Number(l.createdAt.slice(11, 13)) || 0;
    hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1);
    const dow = ((new Date(l.createdAt.replace(' ', 'T')).getDay() + 6) % 7) + 1;
    dowHourMap.set(`${dow}-${hour}`, (dowHourMap.get(`${dow}-${hour}`) ?? 0) + 1);
  }
  const hourlyStats = [...hourMap.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour - b.hour);

  return {
    summary: summarize(logs),
    prevSummary: summarize(prevLogs),
    dailyStats,
    userStats: countBy(logs, (l) => l.username).slice(0, 10).map((x) => ({ username: x.key, count: x.count })),
    ipStats: countBy(logs, (l) => l.ip).slice(0, 10).map((x) => ({ ip: x.key, count: x.count })),
    ipFailStats: countBy(logs.filter((l) => l.status === 'fail'), (l) => l.ip).slice(0, 10).map((x) => ({ ip: x.key, count: x.count })),
    browserStats: countBy(logs, (l) => l.browser).map((x) => ({ browser: x.key, count: x.count })),
    osStats: countBy(logs, (l) => l.os).map((x) => ({ os: x.key, count: x.count })),
    hourlyStats,
    failReasonStats: countBy(logs.filter((l) => l.status === 'fail'), (l) => l.message).slice(0, 8).map((x) => ({ message: x.key, count: x.count })),
    locationStats: countBy(logs, (l) => l.location).slice(0, 10).map((x) => ({ location: x.key, count: x.count })),
    dowHourStats: Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => ({ dow: d + 1, hour: h, count: dowHourMap.get(`${d + 1}-${h}`) ?? 0 })),
    ).flat(),
    resolutionStats: countBy(logs, (l) => (l.screenWidth != null && l.screenHeight != null ? `${l.screenWidth}×${l.screenHeight}` : null))
      .slice(0, 8).map((x) => ({ resolution: x.key, count: x.count })),
    gpuStats: countBy(logs, (l) => l.gpu).slice(0, 8).map((x) => ({ gpu: x.key, count: x.count })),
  };
}

export const loginLogsHandlers = [
  mock(loginLogContract.list, ({ query, ok, paginate }) => {
    const { userId, username, eventType, status } = query;
    const list = mockLoginLogs.filter((log) => {
      if (userId && log.userId !== userId) return false;
      if (username && !log.username.includes(username)) return false;
      if (eventType && log.eventType !== eventType) return false;
      if (status && log.status !== status) return false;
      return true;
    });
    return ok(paginate(list));
  }),

  // 登录日志统计（页面加载时自动拉取，缺失会导致 401 → 跳转登录页）
  mock(loginLogContract.stats, ({ query, ok }) => {
    return ok(buildLoginLogStats(query.days || 30));
  }),

  mock(loginLogContract.clean, ({ query, ok }) => {
    const days = query.days ?? 180;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const deleted = removeWhere(
      mockLoginLogs,
      (log) => new Date(log.createdAt) < cutoff,
    );
    return ok(null, `共删除 ${deleted} 条登录日志`);
  }),
];
