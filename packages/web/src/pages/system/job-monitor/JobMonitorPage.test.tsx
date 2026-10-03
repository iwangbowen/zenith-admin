import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { JobMonitorOverview, JobQueueRow, JobStuckItem } from '@zenith/shared/platform';
import { createDemoJobMonitorOverview, createDemoStuckJobs } from '@/mocks/data/job-monitor';

const state = vi.hoisted(() => ({ query: vi.fn(), stuck: vi.fn(), refetch: vi.fn() }));
vi.mock('@/hooks/queries/job-monitor', () => ({ useJobMonitorOverview: (...args: unknown[]) => state.query(...args), useJobMonitorStuck: (...args: unknown[]) => state.stuck(...args) }));
vi.mock('@/components/PageLoading', () => ({ default: () => <div role="status">正在加载</div> }));
vi.mock('./JobTrendChart', () => ({ default: () => <div role="img" aria-label="作业趋势" /> }));
vi.mock('@/components/DateTimeText', () => ({ default: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/toolbar-controls', () => ({ RefreshButton: ({ onClick }: { onClick: () => void }) => <button onClick={onClick}>刷新</button> }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Card: ({ title, extra, children }: { title?: ReactNode; extra?: ReactNode; children?: ReactNode }) => <div><div>{title}{extra}</div>{children}</div>,
    Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
    Banner: ({ description }: { description: string }) => <div role="alert">{description}</div>,
    Empty: ({ title, description }: { title?: string; description?: string }) => <div>{title}{description}</div>,
    Tag: Box, Space: Box, Row: Box, Col: Box, Divider: Box,
    SideSheet: ({ title, children, visible, onCancel }: { title: string; children?: ReactNode; visible: boolean; onCancel: () => void }) => visible ? <div role="dialog" aria-label={title}><button onClick={onCancel}>关闭</button>{children}</div> : null,
    Typography: { Text: Box, Title: Box },
    Select: ({ value, optionList, onChange }: { value: string; optionList: { value: string; label: string }[]; onChange: (value: string) => void }) => (
      <select aria-label="自动刷新" value={value} onChange={(event) => onChange(event.target.value)}>{optionList.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    ),
  };
});
vi.mock('@/components/ConfigurableTable', () => ({ default: ({ dataSource, columns }: {
  dataSource: (JobQueueRow | JobStuckItem)[];
  columns: { dataIndex?: string; render?: (value: unknown, row: JobQueueRow | JobStuckItem) => ReactNode }[];
}) => <div>{dataSource.map((row) => <div key={'name' in row ? row.name : row.refId}>{columns.map((column, index) => <div key={index}>{column.render?.((row as unknown as Record<string, unknown>)[column.dataIndex ?? ''], row)}</div>)}</div>)}</div> }));

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
  state.stuck.mockReturnValue({ data: createDemoStuckJobs('async-task'), isPending: false, isFetching: false, isError: false, refetch: vi.fn() });
});

describe('JobMonitorPage', () => {
  it('renders all four groups and the overdue schedule breakdown and list', () => {
    show();
    expect(screen.getByText('到期调度')).toBeInTheDocument();
    const schedule = within(screen.getByRole('region', { name: '到期调度扫描' }));
    expect(schedule.getByRole('button', { name: 'CMS 定时发布' })).toBeInTheDocument();
    expect(schedule.queryByRole('button', { name: '目录同步计划' })).not.toBeInTheDocument();
    fireEvent.click(schedule.getByRole('button', { name: '展开全部 11 项' }));
    expect(schedule.getByRole('button', { name: '目录同步计划' })).toBeInTheDocument();
    fireEvent.click(schedule.getByRole('button', { name: '卡死明细' }));
    expect(state.stuck).toHaveBeenLastCalledWith('scheduled-dispatch', true);
  });
  it('groups execution mechanisms and expands type details beyond the first five rows', () => {
    show();
    expect(screen.getByText('执行运行时')).toBeInTheDocument();
    expect(screen.getByText('事件与内容投递')).toBeInTheDocument();
    expect(screen.getByText('业务作业')).toBeInTheDocument();
    const cms = within(screen.getByRole('region', { name: 'CMS 构建发布' }));
    expect(cms.getByRole('button', { name: '站点构建' })).toBeInTheDocument();
    expect(cms.getByRole('button', { name: '媒体处理' })).toBeInTheDocument();
    const tasks = within(screen.getByRole('region', { name: '异步任务' }));
    expect(tasks.queryByRole('button', { name: '演示任务类型 6' })).not.toBeInTheDocument();
    fireEvent.click(tasks.getByRole('button', { name: '展开全部 6 项' }));
    fireEvent.click(tasks.getByRole('button', { name: '演示任务类型 6' }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('taskType=demo-type-5');
    fireEvent.click(tasks.getByRole('button', { name: '收起明细' }));
    expect(tasks.queryByRole('button', { name: '演示任务类型 6' })).not.toBeInTheDocument();
  });
  it('prioritizes critical and warning sources while retaining the isolated unavailable reason', () => {
    const data = createDemoJobMonitorOverview();
    const exportSource = data.sources.find((source) => source.key === 'export-job')!;
    exportSource.health = 'unavailable';
    exportSource.reason = '导出作业探测超时';
    setOverview(data);
    show();
    const order = screen.getAllByRole('region').map(element => element.getAttribute('aria-label'));
    expect(order.indexOf('异步任务')).toBeLessThan(order.indexOf('流程作业'));
    expect(order.indexOf('流程作业')).toBeLessThan(order.indexOf('系统调度队列'));
    expect(order.indexOf('Webhook 投递')).toBeLessThan(order.indexOf('通知派发 Outbox'));
    expect(screen.getByText('导出作业探测超时')).toBeInTheDocument();
    expect(screen.getByText('部分作业源探测不可用，顶部汇总仅包含可用来源。')).toBeInTheDocument();
    expect(screen.getByText('心跳失联')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '通知派发 Outbox' })).getByText('通知派发探测超时')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '通知派发 Outbox' })).queryByText('待处理')).not.toBeInTheDocument();
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

  it('opens the stuck list on demand and navigates from a stuck row', () => {
    show();
    expect(state.stuck).toHaveBeenLastCalledWith(undefined, false);
    fireEvent.click(within(screen.getByRole('region', { name: '异步任务' })).getByRole('button', { name: '卡死明细' }));
    expect(state.stuck).toHaveBeenLastCalledWith('async-task', true);
    const drawer = screen.getByRole('dialog', { name: '异步任务 · 卡死明细' });
    expect(within(drawer).getByText('历史数据导入')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: '前往处理' }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/system/task-center?tab=tasks&status=running&taskId=731');
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭' }));
    expect(state.stuck).toHaveBeenLastCalledWith(undefined, false);
  });

  it('opens an orphan business-job list and links to the target run filter', () => {
    state.stuck.mockReturnValue({ data: createDemoStuckJobs('report-dq'), isPending: false, isFetching: false, isError: false, refetch: vi.fn() });
    show();
    fireEvent.click(within(screen.getByRole('region', { name: '报表数据质量' })).getByRole('button', { name: '卡死明细' }));
    expect(state.stuck).toHaveBeenLastCalledWith('report-dq', true);
    const drawer = screen.getByRole('dialog', { name: '报表数据质量 · 卡死明细' });
    fireEvent.click(within(drawer).getByRole('button', { name: '前往处理' }));
    expect(screen.getByLabelText('当前位置')).toHaveTextContent('/report/quality?tab=runs&status=failed');
  });

  it('counts mirrored business rows only toward stuck totals in the Demo overview', () => {
    const data = createDemoJobMonitorOverview();
    const business = data.sources.filter(source => source.category === 'business');
    expect(business).toHaveLength(6);
    expect(business.reduce((sum, source) => sum + source.counts.pending, 0)).toBeGreaterThan(0);
    const fullSources = data.sources.filter(source => source.category !== 'business' && source.key !== 'drive-rendition' && source.health !== 'unavailable');
    expect(data.totals.backlog).toBe(fullSources.reduce((sum, source) => sum + source.counts.pending, 0));
    expect(data.totals.running).toBe(fullSources.reduce((sum, source) => sum + source.counts.running, 0));
    expect(data.totals.failed24h).toBe(fullSources.reduce((sum, source) => sum + source.counts.failed24h, 0));
    expect(data.totals.stuck).toBe(data.sources.filter(source => source.health !== 'unavailable').reduce((sum, source) => sum + source.counts.stuck, 0));
  });
});
