import { describe, expect, it } from 'vitest';
import type { OutputOf } from '@zenith/shared/core';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { apiAccessLogsHandlers } from './api-access-logs';

async function call(path: string) {
  const request = new Request(`${window.location.origin}${apiAccessLogContract.basePath}${path}`);
  for (const handler of apiAccessLogsHandlers) {
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, correlationId: `access-${path}` });
    if (result?.response) return result.response;
  }
  throw new Error(`No handler matched ${path}`);
}

async function list(query = '') {
  return (await (await call(query)).json() as { data: OutputOf<typeof apiAccessLogContract.list> }).data;
}

describe('API 访问日志 Demo', () => {
  it('列表摘要按时间与 ID 倒序分页，不返回详情快照', async () => {
    const page = await list('?page=1&pageSize=1');
    expect(page.total).toBe(mockApiAccessLogs.length);
    expect(page.list.map((row) => row.id)).toEqual([1]);
    expect(page.list[0]).not.toHaveProperty('queryParams');
    expect(page.list[0]).not.toHaveProperty('requestBody');
    expect(page.list[0]).not.toHaveProperty('userAgent');
    expect(page.list[0]).not.toHaveProperty('errorMessage');
    expect((await list('?page=2&pageSize=1')).list.map((row) => row.id)).toEqual([2]);
  });

  it('访问端、凭证、精确状态、参数与耗时组合筛选返回同一批记录', async () => {
    const params = new URLSearchParams({ userId: '1', accessorName: 'admin', accessorType: 'admin_user', credentialType: 'admin_session', method: 'post', module: '用户', operationKey: 'users.create', routePath: '/api/users', path: '/api/users', correlationId: 'mock-request-002', serviceName: 'zenith', ip: '127.0.', responseCode: '400', status: 'fail', content: 'DEMO', minDurationMs: '40', maxDurationMs: '50' });
    expect((await list(`?${params}`)).list.map((row) => row.id)).toEqual([2]);
    expect((await list('?memberId=18&accessorType=member_user&credentialType=member_session')).list.map((row) => row.id)).toEqual([3]);
    expect((await list('?clientId=missing-client')).list).toEqual([]);
    expect((await list('?userId=18')).list).toEqual([]);
  });

  it('时间筛选使用闭区间，参数检索中的通配符按普通文本处理', async () => {
    const createdAt = mockApiAccessLogs[1].createdAt;
    const params = new URLSearchParams({ startTime: createdAt, endTime: createdAt });
    expect((await list(`?${params}`)).list.map((row) => row.id)).toEqual([2]);
    expect((await list('?content=%25')).list).toEqual([]);
  });

  it('详情保留已脱敏请求快照，不存在的 ID 返回 404', async () => {
    const detail = await (await call('/2')).json() as { data: OutputOf<typeof apiAccessLogContract.detail> };
    expect(detail.data.requestBody).toEqual({ username: 'demo', password: '***' });
    expect((await call('/999999')).status).toBe(404);
  });
});
