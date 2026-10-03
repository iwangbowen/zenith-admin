import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { DirectorySyncRun } from '@zenith/shared/identity';
import type { DbBackup } from '@zenith/shared/ops';
import { createTestQueryClient, createWrapper } from '@/test-utils/query-harness';
import { mockDirectorySyncRuns } from '@/mocks/data/directory-sync';
import { mockBackups } from '@/mocks/data/db-admin-backups';
import { mockDateTimeOffset } from '@/mocks/utils/date';

const state = vi.hoisted(() => ({ canRetry: true, runs: [] as DirectorySyncRun[], backups: [] as DbBackup[], markRun: vi.fn(), markBackup: vi.fn(), confirm: vi.fn(), list: vi.fn() }));
vi.mock('@/utils/confirm', () => ({ confirmDanger: (...args: unknown[]) => state.confirm(...args) }));
vi.mock('@/hooks/usePreferences', () => ({ usePreferences: () => ({ preferences: { tablePageSize: 10 } }), useOptionalPreferences: () => null }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: (permission: string) => permission === 'system:dirsync-log:detail' || state.canRetry }) }));
vi.mock('@/hooks/useEditModal', () => ({ useEditModal: () => ({ openCreate: vi.fn() }) }));
vi.mock('@/components/EditFormModal', () => ({ EditFormModal: () => null }));
vi.mock('@/components/toolbar-controls', () => ({ CreateButton: () => null }));
vi.mock('@/components/list-page', () => ({ ListSearchToolbar: () => null, listTableProps: (query: { data?: { list: unknown[] } }) => ({ dataSource: query.data?.list ?? [] }), deleteAction: () => ({ key: 'delete', hidden: true }) }));
vi.mock('@/components/search-filters', () => ({ FilterSelect: () => null, StatusSelect: () => null, DateRangeFilter: () => null }));
vi.mock('@/components/ResponsiveTableActions', () => ({ createOperationColumn: ({ actions }: { actions: (record: unknown) => { key: string; label: string; hidden?: boolean; onClick?: () => void }[] }) => ({ key: 'operation', render: (_: unknown, record: unknown) => <div>{actions(record).filter((action) => !action.hidden).map((action) => <button key={action.key} onClick={action.onClick}>{action.label}</button>)}</div> }) }));
vi.mock('@/components/ConfigurableTable', () => ({ default: ({ dataSource, columns }: { dataSource: { id: number }[]; columns: { key?: string; render?: (value: unknown, record: unknown) => ReactNode }[] }) => <div>{dataSource.map((record) => <section aria-label={`记录 ${record.id}`} key={record.id}>{columns.find((column) => column.key === 'operation')?.render?.(undefined, record)}</section>)}</div> }));
vi.mock('@douyinfe/semi-ui', () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    SideSheet: ({ visible, children }: { visible: boolean; children: ReactNode }) => visible ? <div role="dialog">{children}</div> : null,
    Tag: Box, Tooltip: Box, Typography: { Text: Box }, Toast: { success: vi.fn(), warning: vi.fn() },
    Form: Object.assign(Box, { Select: Box, Input: Box }),
  };
});
vi.mock('@/hooks/queries/directory-sync', () => ({
  directorySyncRunKeys: { lists: ['directory-sync', 'listRuns'] },
  useDirectorySyncRunList: (query: unknown) => { state.list(query); return { data: { list: state.runs }, isFetching: false }; },
  useDirectorySyncSourceList: () => ({ data: { list: [] } }), useDirectorySyncRunItems: () => ({ data: { list: [] } }),
  useRetryDirectorySyncRun: () => ({ mutate: vi.fn() }), useMarkDirectorySyncRunFailed: () => ({ mutateAsync: state.markRun, isPending: false }),
}));
vi.mock('@/hooks/queries/db-admin', () => ({
  dbAdminKeys: { backupLists: ['db-admin', 'backups'] },
  useDbBackups: (query: unknown) => { state.list(query); return { data: { list: state.backups }, isFetching: false }; },
  useCreateDbBackup: () => ({ isPending: false }), useDeleteDbBackup: () => ({ mutateAsync: vi.fn() }),
  useMarkDbBackupFailed: () => ({ mutateAsync: state.markBackup, isPending: false }),
}));

import DirectorySyncLogsPage from './directory-sync/DirectorySyncLogsPage';
import { BackupsPanel } from './db-admin/BackupsPanel';

function Location() { const location = useLocation(); return <output aria-label="地址">{location.search}</output>; }
function show(content: ReactNode, url = '/system/directory-sync/logs') {
  render(<MemoryRouter initialEntries={[url]}>{content}<Location /></MemoryRouter>, { wrapper: createWrapper(createTestQueryClient()) });
}
beforeEach(() => {
  vi.clearAllMocks(); state.canRetry = true;
  const run = structuredClone(mockDirectorySyncRuns.find((item) => item.id === 3)!);
  state.runs = [run, { ...run, id: 4, startedAt: mockDateTimeOffset(-5 * 60_000) }, { ...run, id: 5, status: 'success' }];
  state.backups = [structuredClone(mockBackups.find((item) => item.id === 4)!), structuredClone(mockBackups.find((item) => item.id === 5)!)];
  state.markRun.mockResolvedValue({ ...run, status: 'failed', message: '管理员手动标记卡死同步为失败' });
  state.markBackup.mockResolvedValue({ ...state.backups[0], status: 'failed' });
});

describe('manual stuck-job closure controls', () => {
  it('consumes the backup status from a monitor drill-down', async () => {
    show(<BackupsPanel canMaintain active />, '/system/db-admin?tab=backups&status=running');
    await waitFor(() => expect(state.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' })));
    expect(screen.getByLabelText('地址')).toHaveTextContent('?tab=backups');
  });
  it('offers sync closure only for an overdue running record and consumes its status deep link', async () => {
    show(<DirectorySyncLogsPage />, '/system/directory-sync/logs?status=running');
    expect(within(screen.getByRole('region', { name: '记录 3' })).getByRole('button', { name: '标记为失败' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '记录 4' })).queryByRole('button', { name: '标记为失败' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '记录 5' })).queryByRole('button', { name: '标记为失败' })).not.toBeInTheDocument();
    await waitFor(() => expect(state.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'running' })));
    expect(screen.getByLabelText('地址')).toHaveTextContent('');
  });

  it('requires retry permission before offering sync closure', () => {
    state.canRetry = false; show(<DirectorySyncLogsPage />);
    expect(screen.queryByRole('button', { name: '标记为失败' })).not.toBeInTheDocument();
  });

  it('confirms before changing the sync status and refreshes the open local detail snapshot', async () => {
    show(<DirectorySyncLogsPage />);
    fireEvent.click(within(screen.getByRole('region', { name: '记录 3' })).getByRole('button', { name: '查看差异' }));
    fireEvent.click(within(screen.getByRole('region', { name: '记录 3' })).getByRole('button', { name: '标记为失败' }));
    expect(state.markRun).not.toHaveBeenCalled();
    expect(state.confirm.mock.lastCall?.[0].okText).toBe('标记为失败');
    await act(async () => { await state.confirm.mock.lastCall?.[0].onOk(); });
    expect(state.markRun).toHaveBeenCalledExactlyOnceWith({ params: { id: 3 } });
    expect(within(screen.getByRole('dialog')).getByText('管理员手动标记卡死同步为失败')).toBeInTheDocument();
  });

  it('offers closure for overdue running and pending backups only to maintainers', () => {
    const base = state.backups[0];
    state.backups.push({ ...base, id: 6, startedAt: mockDateTimeOffset(-5 * 60_000) }, { ...base, id: 7, status: 'success' });
    show(<BackupsPanel canMaintain active />);
    expect(screen.getAllByRole('button', { name: '标记为失败' })).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: '记录 6' })).queryByRole('button', { name: '标记为失败' })).not.toBeInTheDocument();
  });

  it('does not offer backup closure without maintenance permission', () => {
    show(<BackupsPanel canMaintain={false} active />);
    expect(screen.queryByRole('button', { name: '标记为失败' })).not.toBeInTheDocument();
  });

  it('requires confirmation before marking a backup as failed', async () => {
    show(<BackupsPanel canMaintain active />);
    fireEvent.click(within(screen.getByRole('region', { name: '记录 4' })).getByRole('button', { name: '标记为失败' }));
    expect(state.markBackup).not.toHaveBeenCalled();
    await act(async () => { await state.confirm.mock.lastCall?.[0].onOk(); });
    expect(state.markBackup).toHaveBeenCalledExactlyOnceWith({ params: { id: 4 } });
  });
});
