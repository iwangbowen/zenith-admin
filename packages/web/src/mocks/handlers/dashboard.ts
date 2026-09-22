import { dashboardContract } from '@zenith/shared/analytics';
import { mock } from '@/mocks/utils/contract';
import { mockDate } from '@/mocks/utils/date';

function pastDates(days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return mockDate(d);
  });
}

const dates = pastDates(7);

export const dashboardHandlers = [
  mock(dashboardContract.stats, ({ ok }) => ok({
    totalUsers: 12,
    onlineUsers: 3,
    todayLogins: 8,
    todayOperations: 45,
  }, 'success')),

  mock(dashboardContract.charts, ({ ok }) => {
    const loginTrend = dates.map((date) => ({
      date,
      successCount: Math.floor(Math.random() * 12) + 2,
      failCount: Math.floor(Math.random() * 3),
    }));

    const operationTypes = [
      { module: '用户管理', count: 18 },
      { module: '角色管理', count: 12 },
      { module: '菜单管理', count: 7 },
      { module: '字典管理', count: 5 },
      { module: '系统配置', count: 3 },
    ];

    return ok({ loginTrend, operationTypes }, 'success');
  }),
];
