/**
 * AnalyticsQualityTab 单元测试
 *
 * 覆盖点：
 *  1. KPI 卡片按 issueType 汇总 totals 展示正确计数
 *  2. 质量明细表渲染行数据
 *  3. 查询触发 useAnalyticsQuality 重新提交筛选参数（days/eventName/issueType）
 *  4. 租户覆盖列表渲染，新增覆盖表单提交调用 saveOverrideMutation.mutateAsync
 *  5. 删除覆盖调用 deleteOverrideMutation.mutateAsync
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AnalyticsEventOverride, AnalyticsQualityDaily } from '@zenith/shared/analytics';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';

const useAnalyticsQualityMock = vi.fn();
const useAnalyticsEventOverridesMock = vi.fn();
const saveOverrideMutateAsync = vi.fn().mockResolvedValue({});
const deleteOverrideMutateAsync = vi.fn().mockResolvedValue({});
const invalidateQueriesMock = vi.fn();

vi.mock('@/hooks/queries/analytics', () => ({
  analyticsKeys: { data: { quality: ['analytics', 'quality'], overridesLists: ['analytics', 'eventOverrides'] } },
  useAnalyticsQuality: (...args: unknown[]) => useAnalyticsQualityMock(...args),
  useAnalyticsEventOverrides: (...args: unknown[]) => useAnalyticsEventOverridesMock(...args),
  useSaveAnalyticsEventOverride: () => ({ mutateAsync: saveOverrideMutateAsync, isPending: false }),
  useDeleteAnalyticsEventOverride: () => ({ mutateAsync: deleteOverrideMutateAsync, isPending: false }),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }) };
});

vi.mock('@/config', () => ({
  config: { multiTenantMode: true },
}));

// Modal.confirm 使用 Semi 的旧版命令式渲染 API（依赖 createRoot 注入），jsdom 测试环境下无法真实渲染；
// 直接同步调用 onOk 验证「点击删除 → 触发确认 → 调用 deleteOverrideMutation」这条业务链路。
vi.mock('@douyinfe/semi-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@douyinfe/semi-ui')>();
  // Modal 是函数组件并挂了 confirm/info/... 静态方法，不能展开成普通对象（会丢失可调用性），原地覆盖 confirm 即可。
  Object.assign(actual.Modal, {
    confirm: (config: { onOk?: () => void | Promise<void> }) => { void config.onOk?.(); },
  });
  return actual;
});

import AnalyticsQualityTab from './AnalyticsQualityTab';

function renderWithPreferences(ui: React.ReactElement) {
  return render(
    <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
      {ui}
    </PreferencesContext.Provider>,
  );
}

function makeQualityRow(overrides: Partial<AnalyticsQualityDaily> = {}): AnalyticsQualityDaily {
  return {
    id: 1, tenantId: 1, statDate: '2024-01-01', eventName: 'order_submit', issueType: 'missing_required',
    count: 5, sample: { issues: [{ key: 'amount', expected: 'required' }] }, lastSeenAt: '2024-01-01 10:00:00',
    createdAt: '2024-01-01 10:00:00', updatedAt: '2024-01-01 10:00:00', ...overrides,
  };
}

function makeOverride(overrides: Partial<AnalyticsEventOverride> = {}): AnalyticsEventOverride {
  return {
    id: 1, tenantId: 1, eventName: 'order_submit', status: 'disabled', reason: '联调期间临时下线',
    createdAt: '2024-01-01 10:00:00', updatedAt: '2024-01-01 10:00:00', ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  saveOverrideMutateAsync.mockResolvedValue({});
  deleteOverrideMutateAsync.mockResolvedValue({});
  useAnalyticsQualityMock.mockReturnValue({
    data: { items: [makeQualityRow()], totals: [{ issueType: 'missing_required', count: 12 }], totalCount: 1 },
    isFetching: false,
    refetch: vi.fn(),
  });
  useAnalyticsEventOverridesMock.mockReturnValue({
    data: { list: [makeOverride()], total: 1, page: 1, pageSize: 20 },
    isFetching: false,
    refetch: vi.fn(),
  });
});

describe('AnalyticsQualityTab', () => {
  it('KPI 卡片展示 totals 汇总计数', () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('质量明细表渲染行数据', () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    expect(screen.getAllByText('order_submit').length).toBeGreaterThan(0);
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
  });

  it('查询按钮提交筛选并使查询失效', () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    const eventNameInputs = screen.getAllByPlaceholderText('事件名');
    fireEvent.change(eventNameInputs[0], { target: { value: 'order_submit' } });
    const searchButtons = screen.getAllByText('查询');
    fireEvent.click(searchButtons[0]);
    const lastParams = useAnalyticsQualityMock.mock.calls.at(-1)?.[0];
    expect(lastParams.eventName).toBe('order_submit');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['analytics', 'quality'] });
  });

  it('租户覆盖列表渲染禁用状态标签', () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    expect(screen.getByText('联调期间临时下线')).toBeInTheDocument();
  });

  it('新增覆盖表单提交调用 saveOverrideMutation', async () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    // 工具栏桌面 / 移动两份「新增覆盖」按钮，取桌面端（DOM 中靠前）
    fireEvent.click(screen.getAllByText('新增覆盖')[0]);
    const eventNameField = await screen.findByPlaceholderText('如 order_submit');
    fireEvent.change(eventNameField, { target: { value: 'custom_event' } });
    const okButtons = screen.getAllByText('确定');
    fireEvent.click(okButtons[okButtons.length - 1]);
    await waitFor(() => expect(saveOverrideMutateAsync).toHaveBeenCalled());
    const call = saveOverrideMutateAsync.mock.calls[0][0];
    expect(call.values.eventName).toBe('custom_event');
  });

  it('删除覆盖调用 deleteOverrideMutation', async () => {
    renderWithPreferences(<AnalyticsQualityTab />);
    fireEvent.click(screen.getByText('删除'));
    await waitFor(() => expect(deleteOverrideMutateAsync).toHaveBeenCalledWith({ params: { id: 1 } }));
  });
});
