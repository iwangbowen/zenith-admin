import { http, HttpResponse } from 'msw';

export const monitorHandlers = [
  // 系统监控信息（demo 模式返回静态数据）
  http.get('/api/monitor/info', () => {
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        os: {
          platform: 'linux',
          arch: 'x64',
          hostname: 'zenith-demo',
          type: 'Linux',
          release: '5.15.0',
          uptime: 86400,
        },
        cpu: {
          model: 'Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz',
          cores: 8,
          speed: 3800,
          usage: 12.5,
        },
        memory: {
          total: 16 * 1024 * 1024 * 1024,
          used: 6 * 1024 * 1024 * 1024,
          free: 10 * 1024 * 1024 * 1024,
          usagePercent: 37.5,
        },
        disk: {
          total: 512 * 1024 * 1024 * 1024,
          used: 128 * 1024 * 1024 * 1024,
          free: 384 * 1024 * 1024 * 1024,
          usagePercent: 25,
        },
        node: {
          version: 'v20.0.0',
          pid: 12345,
          uptime: 3600,
          memoryUsage: {
            rss: 64 * 1024 * 1024,
            heapTotal: 48 * 1024 * 1024,
            heapUsed: 32 * 1024 * 1024,
            external: 1 * 1024 * 1024,
          },
        },
        database: {
          name: 'zenith_admin',
          size: 8 * 1024 * 1024,
          activeConnections: 3,
          totalConnections: 10,
          tableCount: 12,
        },
        redis: {
          version: '7.2.4',
          uptimeSeconds: 86400,
          connectedClients: 2,
          usedMemory: 2 * 1024 * 1024,
          usedMemoryHuman: '2.00M',
          totalCommandsProcessed: 15842,
          keyspaceHits: 1024,
          keyspaceMisses: 32,
          keyCount: 5,
          role: 'master',
        },
      },
    });
  }),
];
