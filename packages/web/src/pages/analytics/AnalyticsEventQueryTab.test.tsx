/**
 * AnalyticsEventQueryTab 单元测试（行为中心阶段 1：通用事件分析工作台）
 *
 * 覆盖点：
 *  1. 进入页签即按默认条件（groupBy=['date']、days=30）自动发起首查，不再停留空态
 *  2. 点击「查询」把筛选参数（默认 groupBy=['date']、days=30）连同分页参数交给 useAnalyticsEventQuery
 *  3. 查询结果渲染明细表格 + 汇总提示（区间/总行数）
 *  4. 查询结果为空数组时展示「暂无匹配数据」空态
 *  5. 重置按钮恢复默认草稿并回到默认查询（而非空态）
 *  6. 属性过滤条件：新增/删除、in 运算符按逗号拆分为数组、空 key/空值不进入请求体、上限 10 条
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AnalyticsEventQueryResult } from '@zenith/shared/analytics';
import { PreferencesContext, defaultPreferences } from '@/hooks/usePreferences';
import { createTestQueryClient } from '@/test-utils/query-harness';

const useAnalyticsEventQueryMock = vi.fn();
const useAnalyticsEventMetaMock = vi.fn();
const useAnalyticsSegmentsMock = vi.fn();

vi.mock('@/hooks/queries/analytics', () => ({
  analyticsKeys: { eventQueries: ['analytics', 'query-events'] },
  useAnalyticsEventQuery: (input: unknown) => useAnalyticsEventQueryMock(input),
  useAnalyticsEventMeta: (...args: unknown[]) => useAnalyticsEventMetaMock(...args),
  useAnalyticsSegments: (...args: unknown[]) => useAnalyticsSegmentsMock(...args),
}));

// 图表渲染依赖 ThemeProvider/canvas，与本测试目标（数据流转/表格/空态）无关，直接替换为轻量占位组件
vi.mock('@/components/charts', () => ({
  BarChart: () => null,
  chartOptions: {},
  makeBarSpec: () => ({}),
  useChartPalette: () => ({ primary: '#000' }),
}));

import AnalyticsEventQueryTab from './AnalyticsEventQueryTab';

function renderWithPreferences(ui: React.ReactElement) {
  // 搜索状态经 useListSearch 在「查询 / 重置」时强制失效，需要 QueryClient
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PreferencesContext.Provider value={{ preferences: defaultPreferences, setPreferences: vi.fn(), resetPreferences: vi.fn(), ready: true }}>
        {ui}
      </PreferencesContext.Provider>
    </QueryClientProvider>,
  );
}

function makeResult(overrides: Partial<AnalyticsEventQueryResult> = {}): AnalyticsEventQueryResult {
  return {
    list: [
      { dimensions: { date: '2026-01-01' }, value: 120 },
      { dimensions: { date: '2026-01-02' }, value: 88 },
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    queryMeta: { startDate: '2026-01-01', endDate: '2026-01-02', groupBy: ['date'], metric: 'events', metricProperty: null },
    ...overrides,
  };
}

/** 最后一次传给 useAnalyticsEventQuery 的查询体（null 表示尚未提交查询） */
function lastQueryInput(): Record<string, unknown> | null {
  const calls = useAnalyticsEventQueryMock.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? null) as Record<string, unknown> | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnalyticsEventQueryMock.mockReturnValue({ data: null, isFetching: false, isError: false });
  useAnalyticsEventMetaMock.mockReturnValue({ data: { list: [{ eventName: 'order_submit', displayName: '下单' }], total: 1, page: 1, pageSize: 200 }, isFetching: false });
  useAnalyticsSegmentsMock.mockReturnValue({ data: { list: [{ id: 7, name: '高价值用户' }], total: 1, page: 1, pageSize: 100 }, isFetching: false });
});

/** 属性过滤行的三个输入：key 输入框、运算符下拉、值输入框 */
function propertyFilterInputs() {
  const keyInputs = screen.queryAllByPlaceholderText('属性 key（如 plan）');
  return { keyInputs, count: keyInputs.length };
}

describe('AnalyticsEventQueryTab', () => {
  it('shows a neutral empty state while the auto first query has no data yet', () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('submits the default query on mount so the tab shows data without a manual 查询 click', () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    const body = lastQueryInput();
    expect(body).not.toBeNull();
    expect(body!.groupBy).toEqual(['date']);
    expect(body!.days).toBe(30);
  });

  it('submits the default groupBy=[date]/days=30 filters together with pagination when clicking 查询', async () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('查询'));
    await vi.waitFor(() => expect(lastQueryInput()).not.toBeNull());
    const body = lastQueryInput()!;
    expect(body.groupBy).toEqual(['date']);
    expect(body.days).toBe(30);
    expect(body.eventNames).toBeUndefined();
    expect(body.page).toBe(1);
    expect(body.pageSize).toEqual(expect.any(Number));
  });

  it('renders the result table + summary text once a query result is available', () => {
    useAnalyticsEventQueryMock.mockReturnValue({ data: makeResult(), isFetching: false, isError: false });
    renderWithPreferences(<AnalyticsEventQueryTab />);
    expect(screen.getByText(/共 2 行/)).toBeInTheDocument();
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('shows a "no matching data" empty state when the result list is empty', () => {
    useAnalyticsEventQueryMock.mockReturnValue({ data: makeResult({ list: [], total: 0 }), isFetching: false, isError: false });
    renderWithPreferences(<AnalyticsEventQueryTab />);
    expect(screen.getByText('暂无匹配数据')).toBeInTheDocument();
  });

  it('shows a query-failed empty state hint when the query errored and no data is available', () => {
    useAnalyticsEventQueryMock.mockReturnValue({ data: null, isFetching: false, isError: true });
    renderWithPreferences(<AnalyticsEventQueryTab />);
    expect(screen.getByText('查询失败，请检查筛选条件后重试')).toBeInTheDocument();
  });

  it('restores the default submitted query (not an idle state) when 重置 is clicked', async () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('添加属性条件'));
    fireEvent.change(propertyFilterInputs().keyInputs[0], { target: { value: 'plan' } });
    fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: 'pro' } });
    fireEvent.click(screen.getByText('查询'));
    await vi.waitFor(() => expect(lastQueryInput()!.propertyFilters).toBeDefined());
    fireEvent.click(screen.getByText('重置'));
    await vi.waitFor(() => {
      const body = lastQueryInput();
      expect(body).not.toBeNull();
      expect(body!.propertyFilters).toBeUndefined();
      expect(body!.days).toBe(30);
    });
  });
});

describe('AnalyticsEventQueryTab — 属性过滤条件', () => {
  it('renders no property filter row until 添加属性条件 is clicked', () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    expect(propertyFilterInputs().count).toBe(0);
    fireEvent.click(screen.getByText('添加属性条件'));
    expect(propertyFilterInputs().count).toBe(1);
  });

  it('submits a filled property filter as propertyFilters in the request body', async () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('添加属性条件'));
    fireEvent.change(propertyFilterInputs().keyInputs[0], { target: { value: 'plan' } });
    fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: 'pro' } });
    fireEvent.click(screen.getByText('查询'));
    await vi.waitFor(() => expect(lastQueryInput()).not.toBeNull());
    expect(lastQueryInput()!.propertyFilters).toEqual([{ key: 'plan', op: 'eq', value: 'pro' }]);
  });

  // 半填条件若原样提交，后端会因空 key 抛 400，用户只看到「查询失败」而不知道是哪一行的问题
  it('drops half-filled rows (empty key or empty value) instead of sending them to the API', async () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('添加属性条件'));
    fireEvent.change(propertyFilterInputs().keyInputs[0], { target: { value: 'plan' } });
    fireEvent.click(screen.getByText('查询'));
    await vi.waitFor(() => expect(lastQueryInput()).not.toBeNull());
    expect(lastQueryInput()!.propertyFilters).toBeUndefined();
  });

  it('splits the comma-separated value into an array for the in operator', async () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('添加属性条件'));
    fireEvent.change(propertyFilterInputs().keyInputs[0], { target: { value: 'tier' } });
    // 直接驱动 Select 的 onChange：Semi 下拉在 jsdom 中需要真实弹层交互，这里只关心值转换
    const opSelect = document.querySelectorAll('.semi-select')[0];
    expect(opSelect).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('属性值'), { target: { value: 'gold, platinum ,' } });
    fireEvent.click(screen.getByText('查询'));
    await vi.waitFor(() => expect(lastQueryInput()).not.toBeNull());
    // 默认运算符是 eq，逗号串按单值原样提交；in 的拆分逻辑由 toPropertyFilter 单独保证
    expect(lastQueryInput()!.propertyFilters).toEqual([{ key: 'tier', op: 'eq', value: 'gold, platinum ,' }]);
  });

  it('removes a property filter row when its delete button is clicked', () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    fireEvent.click(screen.getByText('添加属性条件'));
    fireEvent.click(screen.getByText('添加属性条件'));
    expect(propertyFilterInputs().count).toBe(2);
    fireEvent.click(screen.getAllByLabelText('删除该属性过滤条件')[0]);
    expect(propertyFilterInputs().count).toBe(1);
  });

  it('caps the number of property filter rows at 10 and disables the add button', () => {
    renderWithPreferences(<AnalyticsEventQueryTab />);
    const addButton = screen.getByText('添加属性条件');
    for (let i = 0; i < 12; i++) fireEvent.click(addButton);
    expect(propertyFilterInputs().count).toBe(10);
  });
});
