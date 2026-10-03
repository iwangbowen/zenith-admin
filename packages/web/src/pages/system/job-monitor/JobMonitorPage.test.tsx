import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { JobMonitorOverview, JobQueueRow } from '@zenith/shared/platform';
import { createDemoJobMonitorOverview } from '@/mocks/data/job-monitor';

const state = vi.hoisted(() => ({ query: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/queries/job-monitor', () => ({ useJobMonitorOverview: (...args: unknown[]) => state.query(...args) }));
vi.mock('@/components/PageLoading', () => ({ default: () => <div role="status">正在加载</div> }));
vi.mock('@/components/DateTimeText', () => ({ default: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/toolbar-controls', () => ({ RefreshButton: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>刷新</button> }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Card: ({ title, extra, children }: { title?: ReactNode; extra?: ReactNode; children?: ReactNode }) => <div><div>{title}{extra}</div>{children}</div>,
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Banner: ({ description }: { description: string }) => <div role="alert">{description}</div>,
    Empty: ({ title, description }: { title?: string; description?: string }) => <div>{title}{description}</div>,
    Tag: Box, Space: Box, Row: Box, Col: Box,
    Typography: { Text: Box, Title: Box },
    Select: ({ value, optionList, onChange }: { value: string; optionList: { value: string; label: string }[]; onChange: (value: string) => void }) => (
      <select aria-label="自动刷新" value={value} onChange={(event) => onChange(event.target.value)}>{optionList.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    ),
  };
});
vi.mock('@/components/ConfigurableTable', () => ({ default: ({ dataSource, columns }: {
  dataSource: JobQueueRow[];
  columns: { render?: (value: unknown, row: JobQueueRow) => ReactNode }[];
}) => <div>{dataSource.map((row) => <div key={row.name}>{columns[0].render?.(row.title, row)}</div>)}</div> }));

import JobMonitorPage from './JobMonitorPage';

function Location() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname}{location.search}</output>;
}

function show() {
  render(<MemoryRouter initialEntries={['/system/job-monitor']}><JobMonitorPage /><Location /></MemoryRouter>);
}

function setOverview(data: JobMonitorOverview | undefined, error?: Error) {
  state.query.mockReturnValue({ data, refetch: state.refetch, isFetching: false, isError: !!error, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOverview(createDemoJobMonitorOverview());
});

describe('JobMonitorPage', () => {
  it('prioritizes critical and warning sources while retaining the isolated unavailable reason', () => {
    const data = createDemoJobMonitorOverview();
    const exportSource = data.sources.find((source) => source.key === 'export-job')!;
    exportSource.health = 'unavailable';
    exportSource.reason = '导出作业探测超时';
    setOverview(data);
    show();
    expect(screen.getAllByRole('region').map((element) => element.getAttribute('aria-label')))
      .toEqual(['异步任务', '流程作业', '系统调度队列', '定时任务', '导出作业']);
    expect(screen.getByText('导出作业探测超时')).toBeInTheDocument();
    expect(screen.getByText('部分作业源探测不可用，顶部汇总仅包含可用来源。')).toBeInTheDocument();
    expect(screen.getByText('心跳失联')).toBeInTheDocument();
  });

  it('navigates to the source processing page with its status filter', () => {
    show();
    fireEvent.click(within(screen.getByRole('region', { name: '流程作业' })).getByRole('button', { name: '前往处理' }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/workflow/monitor?tab=jobs&status=dead');
  });

  it('opens the scheduler queue filter and limits the ranking to twenty queues', () => {
    const data = createDemoJobMonitorOverview();
    data.queues.data = Array.from({ length: 21 }, (_, index) => ({ name: `queue ${index}`, title: `队列 ${index}`, module: 'platform', queued: index, active: 0, deferred: 0, failed: 0 }));
    setOverview(data);
    show();
    expect(screen.queryByRole('button', { name: '队列 0' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '队列 20' }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/system/scheduler?tab=tasks&keyword=queue%2020');
  });

  it('disables polling and refreshes manually', () => {
    show();
    expect(state.query).toHaveBeenLastCalledWith({ refetchInterval: 30_000 });
    fireEvent.change(screen.getByLabelText('自动刷新'), { target: { value: 'off' } });
    expect(state.query).toHaveBeenLastCalledWith({ refetchInterval: false });
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last snapshot visible after a refresh failure', () => {
    setOverview(createDemoJobMonitorOverview(), new Error('连接断开'));
    show();
    expect(screen.getByRole('region', { name: '异步任务' })).toBeInTheDocument();
    expect(screen.getByText('刷新失败，正在展示最近一次快照：连接断开')).toBeInTheDocument();
  });

  it('offers retry when no snapshot can be loaded', () => {
    setOverview(undefined, new Error('无访问权限'));
    show();
    expect(screen.getByText('作业监控加载失败无访问权限')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });
});
