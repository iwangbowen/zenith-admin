import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { JobMonitorOverview, JobQueueRow, JobSourceSummary, JobStuckItem } from '@zenith/shared/platform';
import { createDemoJobMonitorOverview, createDemoStuckJobs } from '@/mocks/data/job-monitor';

const state = vi.hoisted(() => ({ query: vi.fn(), stuck: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/queries/job-monitor', () => ({ useJobMonitorOverview: (...args: unknown[]) => state.query(...args), useJobMonitorStuck: (...args: unknown[]) => state.stuck(...args) }));
vi.mock('@/components/PageLoading', () => ({ default: () => <div role="status">正在加载</div> }));
vi.mock('./JobTrendChart', () => ({ default: () => <div role="img" aria-label="作业趋势" /> }));
vi.mock('@/components/DateTimeText', () => ({ default: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/toolbar-controls', () => ({ RefreshButton: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>刷新</button> }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Button: ({ children, onClick, 'aria-label': ariaLabel }: { children?: React.ReactNode; onClick?: () => void; 'aria-label'?: string }) => <button aria-label={ariaLabel} onClick={onClick}>{children}</button>,
    Empty: ({ title, description }: { title?: string; description?: string }) => <div>{title}{description}</div>,
    Tag: Box, Space: Box,
    Collapse: Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, { Panel: ({ children, header }: { children?: React.ReactNode; header?: React.ReactNode }) => <section><div>{header}</div>{children}</section> }),
    SideSheet: ({ title, children, visible, onCancel }: { title: string; children?: React.ReactNode; visible: boolean; onCancel: () => void }) => visible ? <div role="dialog" aria-label={title}><button onClick={onCancel}>关闭</button>{children}</div> : null,
    Typography: { Text: Box, Title: Box },
    Select: ({ value, optionList, onChange }: { value: string; optionList: { value: string; label: string }[]; onChange: (value: string) => void }) => (
      <select aria-label="自动刷新" value={value} onChange={(event) => onChange(event.target.value)}>{optionList.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    ),
    Table: ({ dataSource, columns }: { dataSource?: Array<Record<string, unknown>>; columns?: Array<{ dataIndex?: string; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }> }) => (
      <div>{(dataSource ?? []).map((row, index) => <div key={String(row.key ?? index)}>{(columns ?? []).map((column, columnIndex) => <span key={columnIndex}>{column.render ? column.render(row[column.dataIndex ?? ''], row) : String(row[column.dataIndex ?? ''] ?? '')}</span>)}</div>)}</div>
    ),
  };
});
vi.mock('@/components/ConfigurableTable', () => ({ default: ({ dataSource, columns, expandedRowRender, groupBy }: {
  dataSource: Array<JobQueueRow | JobStuckItem | JobSourceSummary>;
  columns: Array<{ dataIndex?: string | string[]; render?: (value: unknown, row: JobQueueRow | JobStuckItem | JobSourceSummary) => React.ReactNode }>;
  expandedRowRender?: (row: JobSourceSummary) => React.ReactNode;
  groupBy?: (row: JobSourceSummary) => string;
}) => {
  const groups = new Map<string, Array<JobQueueRow | JobStuckItem | JobSourceSummary>>();
  for (const row of dataSource) {
    const group = groupBy && 'category' in row ? groupBy(row) : '';
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }
  return <div>{[...groups.entries()].flatMap(([group, rows]) => [group ? <div key={`group-${group}`}>{group}</div> : null, ...rows.map((row) => <div key={'name' in row ? row.name : 'refId' in row ? row.refId : row.key}>
    {columns.map((column, index) => {
      const dataIndex = Array.isArray(column.dataIndex) ? column.dataIndex.reduce<unknown>((value, key) => (value as Record<string, unknown> | null)?.[key] ?? null, row) : (row as Record<string, unknown>)[column.dataIndex ?? ''];
      return <span key={index}>{column.render?.(dataIndex, row)}</span>;
    })}
    {'category' in row && expandedRowRender?.(row)}
  </div>)] )}</div>;
} }));

import JobMonitorPage from './JobMonitorPage';

function Location() {
  const location = useLocation();
  return <output aria-label="当前位置">{location.pathname}{location.search}</output>;
}

function show(path = '/system/job-monitor') {
  cleanup();
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/system/job-monitor" element={<JobMonitorPage />} /><Route path="*" element={null} /></Routes><Location /></MemoryRouter>);
}

function setOverview(data: JobMonitorOverview | undefined, error?: Error) {
  state.query.mockReturnValue({ data, refetch: state.refetch, isFetching: false, isError: !!error, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOverview(createDemoJobMonitorOverview());
  state.stuck.mockReturnValue({ data: createDemoStuckJobs('async-task'), isPending: false, isFetching: false, isError: false, refetch: vi.fn() });
});

describe('JobMonitorPage', () => {
  it('uses one expandable source table and keeps incident detail visible', () => {
    show();
    expect(screen.getByRole('region', { name: '作业源状态' })).toBeInTheDocument();
    expect(screen.getAllByText('执行运行时').length).toBeGreaterThan(0);
    expect(screen.getAllByText('事件与内容投递').length).toBeGreaterThan(0);
    expect(screen.getByText('历史数据导入')).toBeInTheDocument();
    expect(screen.getByText('超过心跳回收窗口，等待任务中心回收')).toBeInTheDocument();
  });

  it('drills all summary metrics to a concrete target', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /运行中/ }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/system/scheduler?tab=runs&status=running');
    show();
    fireEvent.click(screen.getByRole('button', { name: /死信/ }));
    expect(screen.getAllByLabelText('当前位置').at(-1)).toHaveTextContent('/system/task-center?tab=tasks&status=dead');
    show();
    fireEvent.click(screen.getByRole('button', { name: /近 24h 失败/ }));
    expect(screen.getAllByLabelText('当前位置').at(-1)).toHaveTextContent('/system/task-center?tab=tasks&status=failed');
  });

  it('opens a source stuck drawer from the table', () => {
    show();
    fireEvent.click(screen.getAllByRole('button', { name: '卡死明细' })[0]);
    expect(state.stuck).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens the scheduler queue filter and limits the ranking to twenty queues', () => {
    const data = createDemoJobMonitorOverview();
    data.queues.data = Array.from({ length: 21 }, (_, index) => ({ name: `queue ${index}`, title: `队列 ${index}`, module: 'platform', queued: index, active: 0, deferred: 0, failed: 0 }));
    setOverview(data);
    show();
    expect(screen.queryByText('队列 0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('队列 20'));
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

  it('offers retry when no snapshot can be loaded', () => {
    setOverview(undefined, new Error('无访问权限'));
    show();
    expect(screen.getByText('作业监控加载失败无访问权限')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(state.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps mirrored business rows out of execution totals', () => {
    const data = createDemoJobMonitorOverview();
    const business = data.sources.filter(source => source.category === 'business');
    expect(business).toHaveLength(6);
    const fullSources = data.sources.filter(source => source.category !== 'business' && source.key !== 'drive-rendition' && source.health !== 'unavailable');
    expect(data.totals.backlog).toBe(fullSources.reduce((sum, source) => sum + source.counts.pending, 0));
    expect(data.totals.running).toBe(fullSources.reduce((sum, source) => sum + source.counts.running, 0));
    expect(data.totals.failed24h).toBe(fullSources.reduce((sum, source) => sum + source.counts.failed24h, 0));
  });
});
