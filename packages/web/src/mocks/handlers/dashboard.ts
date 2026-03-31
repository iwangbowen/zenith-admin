import { http, HttpResponse } from 'msw';

function pastDates(days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toISOString().slice(0, 10);
  });
}

const dates = pastDates(7);

export const dashboardHandlers = [
  http.get('/api/dashboard/stats', () => {
    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: {
        totalUsers: 12,
        activeUsers: 10,
        onlineUsers: 3,
        todayLogins: 8,
        todayOperations: 45,
      },
    });
  }),

  http.get('/api/dashboard/charts', () => {
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

    const userActivity = dates.map((date) => ({
      date,
      activeUsers: Math.floor(Math.random() * 6) + 1,
    }));

    return HttpResponse.json({
      code: 0,
      message: 'success',
      data: { loginTrend, operationTypes, userActivity },
    });
  }),
];
