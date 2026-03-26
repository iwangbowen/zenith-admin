import { http, HttpResponse } from 'msw';

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
];
