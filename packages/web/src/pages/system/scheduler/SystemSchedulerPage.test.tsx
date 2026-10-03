import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Children, isValidElement, type ReactNode } from 'react';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';

const state = vi.hoisted(() => ({ runs: vi.fn() }));
vi.mock('@/hooks/usePreferences', () => ({ usePreferences: () => ({ preferences: { tablePageSize: 10 } }), useOptionalPreferences: () => ({ preferences: { syncPageStateToUrl: false } }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => false }) }));
vi.mock('@/hooks/usePinyinReady', () => ({ usePinyinReady: () => false }));
vi.mock('@/hooks/useEditModal', () => ({ useEditModal: () => ({ editing: null, modalProps: {}, formProps: {} }) }));
vi.mock('@/components/AppModal', () => ({ default: () => null }));
vi.mock('@/components/UserSelect', () => ({ default: () => null }));
vi.mock('@/components/SearchToolbar', () => ({ SearchToolbar: () => null }));
vi.mock('@/components/ConfigurableTable', () => ({ default: ({ dataSource = [] }: { dataSource?: { name: string }[] }) => <div>{dataSource.map((row) => <div key={row.name}>{row.name}</div>)}</div> }));
vi.mock('@/components/list-page', () => ({ ListSearchToolbar: () => null, listTableProps: () => ({}) }));
vi.mock('@/components/search-filters', () => ({ FilterSelect: () => null, KeywordInput: () => null, StatusSelect: () => null, DateRangeFilter: () => null }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: Box, Col: Box, Row: Box, Space: Box, Tag: Box, Typography: { Text: Box, Paragraph: Box }, Form: Box,
    withField: (component: unknown) => component,
    Modal: { confirm: vi.fn() }, SideSheet: () => null, Descriptions: () => null,
    Tabs: ({ children, activeKey }: { children: ReactNode; activeKey: string }) => <div>{Children.toArray(children).filter((child) => isValidElement<{ itemKey: string }>(child) && child.props.itemKey === activeKey)}</div>,
    TabPane: ({ tab, children }: { tab: string; children: ReactNode }) => <section aria-label={tab}>{children}</section>,
  };
});
vi.mock('@/hooks/queries/system-scheduler', () => {
  const query = () => ({ data: undefined, isFetching: false, refetch: vi.fn() });
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    systemSchedulerKeys: { runs: ['scheduler', 'runs'], tasks: ['scheduler', 'tasks'] },
    useSystemSchedulerRuns: (...args: unknown[]) => { state.runs(...args); return query(); },
    useSystemSchedulerNodes: query, useSystemSchedulerRunDetail: query,
    useSystemSchedulerTasks: () => ({ ...query(), data: [
      { name: 'async-tasks', title: '异步任务', description: '', module: 'platform', taskType: 'queue', lastRunStatus: null },
      { name: 'workflow-jobs', title: '流程作业', description: '', module: 'workflow', taskType: 'queue', lastRunStatus: null },
    ] }),
    useAcknowledgeSystemSchedulerAlert: mutation, useCleanupSystemSchedulerRuns: mutation,
    useRunSystemSchedulerTask: mutation, useSaveSystemSchedulerTaskConfig: mutation,
  };
});

import SystemSchedulerPage from './SystemSchedulerPage';

function Location() { const location = useLocation(); return <output aria-label="地址">{location.search}</output>; }
function show(url: string) {
  render(<MemoryRouter initialEntries={[url]}><SystemSchedulerPage /><Location /></MemoryRouter>, { wrapper: createWrapper(createTestQueryClient()) });
}
beforeEach(() => vi.clearAllMocks());

describe('scheduler monitor deep links', () => {
  it('opens runs with the requested valid status even when tab synchronization is disabled', async () => {
    show('/system/scheduler?tab=runs&status=running');
    await waitFor(() => expect(state.runs).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' }), true));
    expect(screen.getByRole('region', { name: '运行日志' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('地址')).toHaveTextContent(''));
  });
  it('filters queue tasks by keyword and consumes the one-time parameters', async () => {
    show('/system/scheduler?tab=tasks&keyword=workflow-jobs');
    await waitFor(() => expect(screen.queryByText('async-tasks')).not.toBeInTheDocument());
    expect(screen.getByText('workflow-jobs')).toBeInTheDocument();
    expect(screen.getByLabelText('地址')).toHaveTextContent('');
  });
  it('ignores an unknown run status', async () => {
    show('/system/scheduler?tab=runs&status=not-a-status');
    await waitFor(() => expect(state.runs).toHaveBeenLastCalledWith(expect.not.objectContaining({ status: 'not-a-status' }), true));
  });
});
