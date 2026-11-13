import { afterEach, describe, expect, it } from 'vitest';
import type { OutputOf } from '@zenith/shared/core';
import { apiAccessLogContract } from '@zenith/shared/platform';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { apiAccessLogsHandlers } from './api-access-logs';
import { mockDateTimeOffset } from '@/mocks/utils/date';
import { mockAccessToken } from '@/mocks/utils/auth';
import { config } from '@/config';

const originalLogs = mockApiAccessLogs.map(row => ({ ...row }));
const originalMultiTenantMode = config.multiTenantMode;
afterEach(() => {
  mockApiAccessLogs.splice(0, mockApiAccessLogs.length, ...originalLogs.map(row => ({ ...row })));
  config.multiTenantMode = originalMultiTenantMode;
});

async function call(path: string, method = 'GET', token: string | null = mockAccessToken('admin')) {
  const request = new Request(`${window.location.origin}${apiAccessLogContract.basePath}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
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
  it('清除保留所选租户视角，不删除其他租户和平台记录', async () => {
    config.multiTenantMode = true;
    const response = await call('/clean?days=0', 'DELETE', mockAccessToken('admin', 2));
    expect((await response.json()).data).toEqual({ deleted: 1 });
    expect(mockApiAccessLogs.map(row => row.id)).toEqual([1, 2]);
  });

  it('未登录和缺少清除权限的会话不能修改日志', async () => {
    config.multiTenantMode = false;
    expect((await call('/clean?days=0', 'DELETE', null)).status).toBe(401);
    expect((await call('/clean?days=0', 'DELETE', mockAccessToken('lisi'))).status).toBe(403);
    config.multiTenantMode = true;
    expect((await call('/clean?days=0', 'DELETE', mockAccessToken('lisi'))).status).toBe(403);
    expect(mockApiAccessLogs).toHaveLength(originalLogs.length);
  });
  it('按保留期删除旧记录，保留近期记录并同步详情和列表', async () => {
    mockApiAccessLogs[0].createdAt = mockDateTimeOffset(-400 * 86_400_000);
    const response = await call('/clean?days=365', 'DELETE');
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ deleted: 1 });
    expect((await list()).total).toBe(2);
    expect((await call('/1')).status).toBe(404);
    expect((await call('/2')).status).toBe(200);
  });

  it('明确传入 0 才清除全部，忽略列表筛选且重复清除返回零', async () => {
    expect((await (await call('/clean', 'DELETE')).json()).data).toEqual({ deleted: 0 });
    expect((await (await call('/clean?days=0&path=not-matched', 'DELETE')).json()).data).toEqual({ deleted: originalLogs.length });
    expect((await list()).total).toBe(0);
    expect((await (await call('/clean?days=0', 'DELETE')).json()).data).toEqual({ deleted: 0 });
  });

  it.each(['', '%20', '-1', 'abc'])('非法天数 %s 返回 400 且不修改日志', async days => {
    expect((await call(`/clean?days=${days}`, 'DELETE')).status).toBe(400);
    expect(mockApiAccessLogs).toHaveLength(originalLogs.length);
  });
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
