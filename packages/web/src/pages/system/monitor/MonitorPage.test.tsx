import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MonitorHistoryPoint } from '@zenith/shared/platform';
import { PreferencesContext } from '@/hooks/usePreferences';
import { createPreferencesContext } from '@/test-utils/preferences';
import { useMonitorRefreshController } from './useMonitorRefreshController';
import MonitorPage from './MonitorPage';

vi.mock('./useMonitorRefreshController', () => ({ useMonitorRefreshController: vi.fn() }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => false }) }));
vi.mock('@/hooks/queries/exception-logs', () => ({ useExceptionOverview: () => ({ data: undefined }) }));
// 保留真实页面、Tabs、Button、Banner 与时间组件；只隔离依赖 Canvas 的图表渲染。
vi.mock('@/components/charts', () => ({
  LineChart: ({ data }: { data: unknown[] }) => <div role="img" aria-label="监控趋势图" data-points={JSON.stringify(data)} />,
  makeLineSpec: ({ data }: { data: unknown[] }) => ({ data }),
  chartOptions: {},
  useChartPalette: () => [],
}));

type Controller = ReturnType<typeof useMonitorRefreshController>;
const queryTime = new Date('2026-09-21T16:19:30').getTime();
const historyPoint: MonitorHistoryPoint = {
  t: '2026-09-21 16:18:00',
  cpu: 10, memory: 20, disk: 30, swap: 0, load1: 1, procCpu: 5, heap: 40,
  loopLag: 2, qps: 3, errorRate: 0, netRxBps: 4, netTxBps: 5, diskReadBps: 6, diskWriteBps: 7,
  cpuMax: 12, memoryMax: 22, diskMax: 30, swapMax: 0, load1Max: 2, procCpuMax: 8, heapMax: 45,
  loopLagMax: 3, qpsMax: 5, errorRateMax: 0, netRxBpsMax: 6, netTxBpsMax: 7, diskReadBpsMax: 8, diskWriteBpsMax: 9,
};
const refresh = vi.fn<Controller['refresh']>();
const setRefreshInterval = vi.fn<Controller['setRefreshInterval']>();
let controller: Controller;
const preferences = createPreferencesContext({ timeDisplay: 'relative', syncPageStateToUrl: true });

function page(initialEntry = '/system/monitor?tab=history') {
  return (
    <PreferencesContext.Provider value={preferences}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <MonitorPage />
      </MemoryRouter>
    </PreferencesContext.Provider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('zenith_monitor_prefs');
  localStorage.setItem('zenith_monitor_prefs', JSON.stringify({ refreshInterval: -1 }));
  refresh.mockResolvedValue(undefined);
  controller = {
    isHistory: true,
    data: null,
    series: [],
    wsMetrics: null,
    history: [historyPoint],
    historyLoading: false,
    realtimeInterval: -1,
    historyInterval: 60000,
    refreshInterval: 60000,
    refreshOptions: [
      { label: '自动更新（每分钟）', value: 60000 },
      { label: '暂停自动更新', value: 0 },
    ],
    setRefreshInterval,
    refresh,
    loading: false,
    updatedAt: queryTime,
    latestHistoryPeriod: historyPoint.t,
    sseEnabled: false,
    sseStatus: 'idle',
    errorMessage: null,
  };
  vi.mocked(useMonitorRefreshController).mockImplementation(() => controller);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem('zenith_monitor_prefs');
});

describe('MonitorPage history refresh controls', () => {
  it('renders history directly without a realtime snapshot and routes the only refresh button to the current controller', () => {
    const { container } = render(page());

    expect(useMonitorRefreshController).toHaveBeenCalledWith(expect.objectContaining({
      activeTab: 'history', historyRange: '1h', initialRefreshInterval: -1,
    }));
    expect(screen.getByRole('tab', { name: '历史趋势' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('CPU / 内存 / 磁盘 / Swap 使用率')).toBeVisible();
    const charts = screen.getAllByRole('img', { name: '监控趋势图' });
    expect(charts).toHaveLength(6);
    expect(charts[0]).toHaveAttribute('data-points', expect.stringContaining('"cpu":10'));

    const buttons = screen.getAllByRole('button', { name: '刷新' });
    expect(buttons).toHaveLength(1);
    expect(container.querySelector('.monitor-header')).toContainElement(buttons[0]);
    fireEvent.click(buttons[0]);
    expect(refresh).toHaveBeenCalledTimes(1);

    expect(screen.getByRole('status', { name: '自动更新已开启' })).toBeVisible();
    expect(screen.queryByText('自动更新 · 每分钟')).not.toBeInTheDocument();
    expect(screen.getByText('自动更新（每分钟）').closest('[role="combobox"]')).toHaveClass('monitor-refresh-select');
    expect(screen.getByText('自动更新（每分钟）')).toBeVisible();
    expect(screen.getByText('查询时间：2026-09-21 16:19:30')).toBeVisible();
    expect(screen.getByText('最新数据时段：2026-09-21 16:18:00')).toBeVisible();
    expect(container.querySelector('.monitor-sse-tag')).toBeNull();
    expect(screen.queryByText(/数据更新时间|实时更新 ·/)).not.toBeInTheDocument();
  });

  it('shows an accessible live status dot without repeating the selected realtime mode as a visible tag', () => {
    controller = {
      ...controller, isHistory: false, sseEnabled: true, sseStatus: 'open', refreshInterval: -1,
      refreshOptions: [
        { label: '实时更新（约 10 秒）', value: -1 },
        { label: '暂停自动更新', value: 0 },
      ],
    };
    const { container } = render(page('/system/monitor'));

    expect(screen.getByRole('status', { name: '实时连接正常' })).toBeVisible();
    expect(screen.getAllByText('实时更新（约 10 秒）')).toHaveLength(1);
    expect(screen.getByText('实时更新（约 10 秒）').closest('[role="combobox"]')).toHaveClass('monitor-refresh-select');
    expect(screen.queryByText('实时更新 · 约 10 秒一次')).not.toBeInTheDocument();
    expect(container.querySelector('.monitor-header .semi-tag')).toBeNull();
    expect(screen.queryByText(/查询时间：|最新数据时段：/)).not.toBeInTheDocument();
    expect(screen.getByText('数据更新时间：2026-09-21 16:19:30')).toBeVisible();
  });

  it('shows the current refresh loading state while retaining the historical charts', () => {
    const view = render(page());
    controller = { ...controller, loading: true, historyLoading: true };
    view.rerender(page());

    expect(screen.getByRole('button', { name: '刷新' })).toHaveClass('semi-button-loading');
    expect(screen.getAllByRole('img', { name: '监控趋势图' })).toHaveLength(6);
    expect(screen.getByText('查询时间：2026-09-21 16:19:30')).toBeVisible();

    controller = { ...controller, loading: false, historyLoading: false };
    view.rerender(page());
    expect(screen.getByRole('button', { name: '刷新' })).not.toHaveClass('semi-button-loading');
  });

  it('keeps the previous history and successful query time visible when refreshing fails', () => {
    const view = render(page());
    controller = { ...controller, errorMessage: '历史趋势更新失败：网络暂时不可用。请点击刷新重试。' };
    view.rerender(page());

    expect(screen.getByText(controller.errorMessage!)).toBeVisible();
    expect(screen.getAllByRole('img', { name: '监控趋势图' })).toHaveLength(6);
    expect(screen.getByText('查询时间：2026-09-21 16:19:30')).toBeVisible();
    expect(screen.getByText('最新数据时段：2026-09-21 16:18:00')).toBeVisible();
    expect(screen.queryByText('历史趋势加载失败，请点击顶部刷新重试')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 CSV' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows history loading and a retryable error before any history or realtime data exists', () => {
    controller = {
      ...controller, history: [], updatedAt: 0, latestHistoryPeriod: undefined,
      loading: true, historyLoading: true,
    };
    const view = render(page());
    expect(screen.getByRole('tab', { name: '历史趋势' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('加载中…')).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新' })).toHaveClass('semi-button-loading');
    expect(screen.queryByText(/查询时间：|最新数据时段：/)).not.toBeInTheDocument();

    controller = {
      ...controller, loading: false, historyLoading: false,
      errorMessage: '历史趋势更新失败：请求超时。请点击刷新重试。',
    };
    view.rerender(page());
    expect(screen.getByText('历史趋势加载失败，请点击顶部刷新重试')).toBeVisible();
    expect(screen.getAllByRole('button', { name: '刷新' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '刷新' })).not.toHaveClass('semi-button-loading');
    expect(screen.getByRole('button', { name: '导出 CSV' })).toBeDisabled();
  });
});
