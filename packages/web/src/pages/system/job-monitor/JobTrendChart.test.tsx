import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { JobMonitorTrend } from '@zenith/shared/platform';

const state = vi.hoisted(() => ({ query: vi.fn(), chart: vi.fn() }));
vi.mock('@/hooks/queries/job-monitor', () => ({ useJobMonitorTrend: (...args: unknown[]) => state.query(...args) }));
vi.mock('@/components/charts', () => ({
  LineChart: (props: unknown) => { state.chart(props); return <div role="img" aria-label="作业趋势折线图" />; },
  makeLineSpec: () => ({}), chartOptions: {}, compactCount: (value: number) => String(value),
  useChartPalette: () => ({ primary: 'blue', danger: 'red', warning: 'orange', risk: 'pink' }),
}));
vi.mock('@/components/toolbar-controls', () => ({ RefreshButton: () => <button>刷新</button> }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Banner: ({ description }: { description: string }) => <div role="alert">{description}</div>,
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Typography: { Text: Box },
  };
});

import JobTrendChart from './JobTrendChart';

function setPoints(points: JobMonitorTrend['points']) {
  state.query.mockReturnValue({ data: { points }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() });
}
beforeEach(() => { vi.clearAllMocks(); setPoints([{ time: '2026-10-03 12:00:00', backlog: 0, stuck: 0, dead: 0, failed1h: 0 }]); });

describe('job trend chart', () => {
  it('switches between all four supported ranges', () => {
    render(<JobTrendChart />);
    expect(state.query).toHaveBeenLastCalledWith('24h');
    for (const [range, label] of [['1h', '近 1 小时'], ['6h', '近 6 小时'], ['7d', '近 7 天'], ['24h', '近 24 小时']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(state.query).toHaveBeenLastCalledWith(range);
    }
  });

  it('retains missing facts as gaps while preserving a measured zero', () => {
    setPoints([
      { time: '2026-10-03 12:00:00', backlog: 0, stuck: 1, dead: 0, failed1h: 2 },
      { time: '2026-10-03 12:01:00', backlog: null, stuck: null, dead: null, failed1h: null },
    ]);
    render(<JobTrendChart />);
    const specs = state.chart.mock.calls.map((call) => call[0]);
    expect(specs).toHaveLength(3);
    // 积压格：缺失样本保留断点，实测 0 不被抹掉
    expect(specs[0].invalidType).toBe('break');
    expect(specs[0].data[0].values.filter((point: { __x: string }) => point.__x === '2026-10-03 12:01:00').map((point: { __value: number | null }) => point.__value)).toEqual([null]);
    expect(specs[0].data[0].values[0].__value).toBe(0);
    // 卡死与死信同格：两条线都保留断点，实测值按线序排列
    expect(specs[1].data[0].values.filter((point: { __x: string }) => point.__x === '2026-10-03 12:01:00').map((point: { __value: number | null }) => point.__value)).toEqual([null, null]);
    expect(specs[1].data[0].values[0].__value).toBe(1);
    expect(specs[1].data[0].values[1].__value).toBe(0);
    expect(screen.getAllByRole('img', { name: '作业趋势折线图' })).toHaveLength(3);
    expect(screen.getByText('卡死与死信')).toBeInTheDocument();
  });

  it('keeps all chart containers and shows an in-chart empty state when no samples are available', () => {
    setPoints([{ time: '2026-10-03 12:00:00', backlog: null, stuck: null, dead: null, failed1h: null }]);
    render(<JobTrendChart />);
    expect(screen.getAllByRole('img', { name: '作业趋势折线图' })).toHaveLength(3);
    expect(screen.getAllByRole('status', { name: '暂无可用的作业趋势样本' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: '近 7 天' })).toBeInTheDocument();
  });

  it('shows an empty overlay only for a metric without samples', () => {
    setPoints([{ time: '2026-10-03 12:00:00', backlog: 2, stuck: null, dead: null, failed1h: null }]);
    render(<JobTrendChart />);
    expect(screen.getAllByRole('img', { name: '作业趋势折线图' })).toHaveLength(3);
    expect(screen.getAllByRole('status', { name: '暂无可用的作业趋势样本' })).toHaveLength(2);
  });

  it('explains a trend failure even when no historical sample is available', () => {
    state.query.mockReturnValue({ data: undefined, isPending: false, isError: true, error: new Error('采集历史不可用') });
    render(<JobTrendChart />);
    expect(screen.getByRole('alert')).toHaveTextContent('趋势加载失败：采集历史不可用');
  });
});
