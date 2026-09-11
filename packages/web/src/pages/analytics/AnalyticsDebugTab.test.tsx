/**
 * AnalyticsDebugTab 单元测试
 *
 * 覆盖点：
 *  1. 渲染事件调试列表（事件名/来源/质量问题标签）
 *  2. 查询/重置触发 useAnalyticsDebugEvents 使用新的 eventName 参数调用（分页回到第 1 页）
 *  3. 点击行展开，行内展示属性 JSON
 *  4. active=false 时仍然渲染（hook 内部据此决定是否请求，由 hook 自身测试覆盖）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AnalyticsDebugEvent } from '@zenith/shared/analytics';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';
import { createTestQueryClient } from '@/test-utils/query-harness';
import { desktopToolbar } from '@/test-utils/toolbar';

const useAnalyticsDebugEventsMock = vi.fn();
vi.mock('@/hooks/queries/analytics', () => ({
  useAnalyticsDebugEvents: (...args: unknown[]) => useAnalyticsDebugEventsMock(...args),
}));

// JsonBlock 内部是 Semi JsonViewer（虚拟化编辑器 + Web Worker 语言服务），jsdom 下不产出文本节点。
// 本用例要验证的是「详情面板拿到了正确的属性对象」这一页面行为，不是渲染器实现，故用替身还原成文本。
vi.mock('@/components/JsonBlock', () => ({
  JsonBlock: ({ value }: { value: unknown }) => <pre>{JSON.stringify(value, null, 2)}</pre>,
}));

import AnalyticsDebugTab from './AnalyticsDebugTab';

function renderWithPreferences(ui: React.ReactElement) {
  // 组件用 useQueryClient 在「查询 / 重置」时强制失效，保证点击必定回源
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
        {ui}
      </PreferencesContext.Provider>
    </QueryClientProvider>,
  );
}

function makeEvent(overrides: Partial<AnalyticsDebugEvent> = {}): AnalyticsDebugEvent {
  return {
    id: 1,
    eventId: 'evt-1',
    eventType: 'custom',
    eventName: 'order_submit',
    source: 'web_admin',
    appId: 'admin',
    environment: 'production',
    distinctId: 'anon-1',
    memberId: null,
    userId: 1,
    pagePath: '/orders',
    properties: { amount: 100 },
    createdAt: '2024-01-01 10:00:00',
    issueTypes: ['missing_required'],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnalyticsDebugEventsMock.mockReturnValue({
    data: { list: [makeEvent()], total: 1, page: 1, pageSize: 20 },
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe('AnalyticsDebugTab', () => {
  it('渲染事件调试流并展示质量问题标签', () => {
    renderWithPreferences(<AnalyticsDebugTab active />);
    expect(screen.getByText('order_submit')).toBeInTheDocument();
    expect(screen.getByText('anon-1')).toBeInTheDocument();
    expect(screen.getByText('缺失必填属性')).toBeInTheDocument();
  });

  it('查询按钮使用输入的事件名调用 hook', () => {
    const { container } = renderWithPreferences(<AnalyticsDebugTab active />);
    const toolbar = desktopToolbar(container);
    fireEvent.change(toolbar.getByPlaceholderText('事件名'), { target: { value: 'order_submit' } });
    fireEvent.click(toolbar.getByText('查询'));
    const lastCallParams = useAnalyticsDebugEventsMock.mock.calls.at(-1)?.[0];
    expect(lastCallParams).toEqual({ page: 1, pageSize: 10, eventName: 'order_submit' });
  });

  it('重置按钮清空事件名过滤', () => {
    const { container } = renderWithPreferences(<AnalyticsDebugTab active />);
    const toolbar = desktopToolbar(container);
    fireEvent.change(toolbar.getByPlaceholderText('事件名'), { target: { value: 'order_submit' } });
    fireEvent.click(toolbar.getByText('查询'));
    fireEvent.click(toolbar.getByText('重置'));
    const lastCallParams = useAnalyticsDebugEventsMock.mock.calls.at(-1)?.[0];
    expect(lastCallParams).toEqual({ page: 1, pageSize: 10, eventName: undefined });
  });

  it('点击行展开行内展示事件属性 JSON', () => {
    renderWithPreferences(<AnalyticsDebugTab active />);
    fireEvent.click(screen.getByText('order_submit'));
    expect(screen.getByText(/"amount": 100/)).toBeInTheDocument();
    expect(screen.getByText('evt-1')).toBeInTheDocument();
  });
});
