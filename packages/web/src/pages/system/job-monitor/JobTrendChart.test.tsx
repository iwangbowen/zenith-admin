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
    Card: ({ title, children }: { title: ReactNode; children: ReactNode }) => <div>{title}{children}</div>,
    Banner: ({ description }: { description: string }) => <div role="alert">{description}</div>,
    Empty: ({ description }: { description: string }) => <div>{description}</div>,
    Space: Box, Typography: { Text: Box }, Skeleton: Box,
    Select: ({ value, optionList, onChange }: { value: string; optionList: { value: string; label: string }[]; onChange: (value: string) => void }) => (
      <select aria-label="趋势时间范围" value={value} onChange={(event) => onChange(event.target.value)}>{optionList.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    ),
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
    for (const range of ['1h', '6h', '7d', '24h']) {
      fireEvent.change(screen.getByLabelText('趋势时间范围'), { target: { value: range } });
      expect(state.query).toHaveBeenLastCalledWith(range);
    }
  });

  it('retains missing facts as gaps while preserving a measured zero', () => {
    setPoints([
      { time: '2026-10-03 12:00:00', backlog: 0, stuck: 1, dead: 0, failed1h: 2 },
      { time: '2026-10-03 12:01:00', backlog: null, stuck: null, dead: null, failed1h: null },
    ]);
    render(<JobTrendChart />);
    const spec = state.chart.mock.lastCall?.[0];
    expect(spec.invalidType).toBe('break');
    expect(spec.data[0].values.filter((point: { __x: string }) => point.__x === '2026-10-03 12:01:00').map((point: { __value: number | null }) => point.__value)).toEqual([null, null, null, null]);
    expect(spec.data[0].values[0].__value).toBe(0);
    expect(screen.getByRole('img', { name: '作业趋势折线图' })).toBeInTheDocument();
  });

  it('shows an empty state when every metric lacks a historical fact', () => {
    setPoints([{ time: '2026-10-03 12:00:00', backlog: null, stuck: null, dead: null, failed1h: null }]);
    render(<JobTrendChart />);
    expect(screen.getByText('暂无可用的作业趋势样本')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('explains a trend failure even when no historical sample is available', () => {
    state.query.mockReturnValue({ data: undefined, isPending: false, isError: true, error: new Error('采集历史不可用') });
    render(<JobTrendChart />);
    expect(screen.getByRole('alert')).toHaveTextContent('趋势加载失败：采集历史不可用');
  });
});
