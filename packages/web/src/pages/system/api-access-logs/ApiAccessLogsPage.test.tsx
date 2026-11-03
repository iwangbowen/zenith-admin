import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiAccessLogContract, apiAccessLogListItemSchema } from '@zenith/shared/platform';
import { ApiRecorder, createRequestMock, createTestQueryClient } from '@/test-utils/query-harness';
import { desktopToolbar } from '@/test-utils/toolbar';
import { mockApiAccessLogs } from '@/mocks/data/logs';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import ApiAccessLogsPage from './ApiAccessLogsPage';

const recorder = new ApiRecorder();
const permissions = vi.hoisted(() => new Set<string>());
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => recorder) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: (permission: string) => permissions.has(permission) }) }));
vi.mock('@/components/ExportButton', () => ({ default: ({ query, permission }: { query: Record<string, unknown>; permission: string }) => permissions.has(permission) ? <button data-testid="export" data-query={JSON.stringify(query)}>导出测试</button> : null }));

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderPage() {
  const client = createTestQueryClient();
  return render(<MemoryRouter><QueryClientProvider client={client}><PreferencesContext.Provider value={createPreferencesContext()}><ApiAccessLogsPage /><Location /></PreferencesContext.Provider></QueryClientProvider></MemoryRouter>);
}

function lastListQuery() {
  const call = recorder.calls.filter((entry) => entry.url.split('?')[0] === apiAccessLogContract.list.fullPath).at(-1);
  return new URL(call!.url, 'http://localhost').searchParams;
}

beforeEach(() => {
  recorder.reset();
  permissions.clear();
  permissions.add('system:api-access-log:export');
  recorder.on('GET', apiAccessLogContract.list.fullPath, { list: [apiAccessLogListItemSchema.parse(mockApiAccessLogs[0])], total: 1, page: 1, pageSize: 20 });
  recorder.on('GET', `${apiAccessLogContract.basePath}/1`, mockApiAccessLogs[0]);
});

describe('API access log page', () => {
  it('默认不限制时间范围；草稿不查询，提交、导出与重置使用同一组条件', async () => {
    const { container } = renderPage();
    await screen.findByText('admin');
    expect(lastListQuery().has('startTime')).toBe(false);
    expect(lastListQuery().has('endTime')).toBe(false);
    const toolbar = desktopToolbar(container);
    recorder.resetCalls();
    fireEvent.change(toolbar.getByPlaceholderText('搜索访问人 / 调用方'), { target: { value: 'operator' } });
    fireEvent.change(toolbar.getByPlaceholderText('HTTP 状态码'), { target: { value: '403' } });
    expect(recorder.calls).toHaveLength(0);
    fireEvent.click(toolbar.getByText('查询'));
    await waitFor(() => expect(lastListQuery().get('accessorName')).toBe('operator'));
    expect(lastListQuery().get('responseCode')).toBe('403');
    const exported = JSON.parse(toolbar.getByTestId('export').getAttribute('data-query')!);
    expect(exported).toMatchObject({ accessorName: 'operator', responseCode: 403 });
    expect(exported).not.toHaveProperty('startTime');
    expect(exported).not.toHaveProperty('endTime');
    fireEvent.click(toolbar.getByText('重置'));
    await waitFor(() => expect(toolbar.getByPlaceholderText('搜索访问人 / 调用方')).toHaveValue(''));
    await waitFor(() => expect(lastListQuery().has('accessorName')).toBe(false));
    expect(lastListQuery().has('responseCode')).toBe(false);
  });

  it('只在打开详情时取快照，并按权限提供异常与链路跳转', async () => {
    permissions.add('system:trace:view');
    permissions.add('system:exception-log:list');
    renderPage();
    await screen.findByText('admin');
    expect(recorder.countOf('GET', `${apiAccessLogContract.basePath}/1`)).toBe(0);
    fireEvent.click(screen.getByText('详情'));
    await screen.findByText('API 访问日志 #1');
    expect(screen.getAllByText('管理端登录态')).toHaveLength(2);
    expect(screen.getByText(mockApiAccessLogs[0].userAgent!)).toBeInTheDocument();
    expect(screen.getByText('demo-host / 1001')).toBeInTheDocument();
    expect(recorder.countOf('GET', `${apiAccessLogContract.basePath}/1`)).toBe(1);
    fireEvent.click(screen.getByText('查看关联异常'));
    expect(screen.getByTestId('location')).toHaveTextContent('/system/exception-logs?tab=events&traceId=mock-request-001');
  });

  it('无导出或保留策略权限时隐藏入口，详情加载失败提供重试', async () => {
    permissions.clear();
    recorder.on('GET', `${apiAccessLogContract.basePath}/1`, () => { throw new Error('日志不存在或已清理'); });
    renderPage();
    await screen.findByText('admin');
    expect(screen.queryByTestId('export')).not.toBeInTheDocument();
    expect(screen.queryByText('数据保留策略')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('详情'));
    expect(await screen.findByText('日志详情加载失败')).toBeInTheDocument();
    expect(screen.getByText('日志不存在或已清理')).toBeInTheDocument();
    expect(screen.queryByText('查看链路')).not.toBeInTheDocument();
    recorder.on('GET', `${apiAccessLogContract.basePath}/1`, mockApiAccessLogs[0]);
    fireEvent.click(screen.getByText('刷新'));
    expect(await screen.findByText('API 访问日志 #1')).toBeInTheDocument();
  });
});
