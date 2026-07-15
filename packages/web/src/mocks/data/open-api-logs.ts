import type { OpenApiCallLog } from '@zenith/shared';
import dayjs from 'dayjs';

const APPS = [
  { clientId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', appName: '示例应用（授权码模式）', environment: 'production' as const },
  { clientId: 'f0e1d2c3-b4a5-6789-0abc-de1234567891', appName: '内部服务（客户端凭证）', environment: 'production' as const },
  { clientId: 'c0ffee00-1234-5678-9abc-def012345678', appName: '移动端公开客户端', environment: 'sandbox' as const },
];
const ENDPOINTS = [
  { method: 'GET', path: '/api/open/v1/ping', scope: null as string | null },
  { method: 'GET', path: '/api/open/v1/echo', scope: 'data:read' },
  { method: 'POST', path: '/api/open/v1/echo', scope: 'data:write' },
  { method: 'GET', path: '/api/open/v1/userinfo', scope: 'user:read' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function gen(): OpenApiCallLog[] {
  const logs: OpenApiCallLog[] = [];
  let id = 1;
  for (let d = 6; d >= 0; d--) {
    const count = 14 + Math.floor(Math.random() * 22);
    for (let i = 0; i < count; i++) {
      const app = pick(APPS);
      const ep = pick(ENDPOINTS);
      const success = Math.random() > 0.12;
      const t = dayjs()
        .subtract(d, 'day')
        .hour(Math.floor(Math.random() * 24))
        .minute(Math.floor(Math.random() * 60))
        .second(Math.floor(Math.random() * 60));
      logs.push({
        id: id++,
        clientId: app.clientId,
        appName: app.appName,
        method: ep.method,
        path: ep.path,
        statusCode: success ? 200 : Math.random() > 0.5 ? 429 : 403,
        success,
        durationMs: 20 + Math.floor(Math.random() * 180),
        ip: `203.0.113.${Math.floor(Math.random() * 254) + 1}`,
        userAgent: 'zenith-sdk/1.0',
        scope: ep.scope,
        errorMessage: success ? null : '调用失败',
        requestId: null,
        environment: app.environment,
        createdAt: t.format('YYYY-MM-DD HH:mm:ss'),
      });
    }
  }
  return logs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export const mockOpenApiLogs: OpenApiCallLog[] = gen();
