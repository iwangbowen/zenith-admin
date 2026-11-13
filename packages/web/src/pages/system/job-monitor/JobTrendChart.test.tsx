import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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
  it('retains missing facts as gaps while preserving a measured zero', () => {
    setPoints([
      { time: '2026-10-03 12:00:00', backlog: 0, stuck: 1, dead: 0, failed1h: 2 },
      { time: '2026-10-03 12:01:00', backlog: null, stuck: null, dead: null, failed1h: null },
    ]);
    render(<JobTrendChart />);
    const specs = state.chart.mock.calls.map((call) => call[0]);
    const points = specs.flatMap(spec => spec.data.flatMap((data: { values: Array<{ __x: string; __value: number | null }> }) => data.values));
    const missing = points.filter(point => point.__x === '2026-10-03 12:01:00');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every(point => point.__value === null)).toBe(true);
    const measured = points.filter(point => point.__x === '2026-10-03 12:00:00');
    expect(measured.map(point => point.__value)).toEqual(expect.arrayContaining([0, 1, 2]));
  });
});
