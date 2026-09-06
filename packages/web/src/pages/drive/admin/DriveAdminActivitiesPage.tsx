import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { DRIVE_ACTIVITY_ACTION_LABELS, DRIVE_ACTIVITY_ACTION_OPTIONS, type DriveActivity, type DriveActivityAction } from '@zenith/shared/drive';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { FileNameCell } from '@/components/FileNameCell';
import { SearchToolbar } from '@/components/SearchToolbar';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import UserSelect from '@/components/UserSelect';
import { useListSearch } from '@/hooks/useListSearch';
import { driveKeys, useDriveAdminActivities, useDriveSpaceList } from '@/hooks/queries/drive';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { describeActivityDetail } from '../drive-utils';

interface SearchParams {
  keyword: string;
  spaceId: number | undefined;
  actorId: number | undefined;
  action: DriveActivityAction | undefined;
  timeRange: [Date, Date] | null;
}

const DANGER_ACTIONS: DriveActivityAction[] = ['delete', 'purge', 'share_revoke', 'permission_change', 'inherit_change'];

export default function DriveAdminActivitiesPage() {
  const navigate = useNavigate();
  const { page, pageSize, buildPagination, draftParams, setDraftParams, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', spaceId: undefined, actorId: undefined, action: undefined, timeRange: null }, listKey: driveKeys.adminActivitiesPrefix });
  const listParams = {
    keyword: submittedParams.keyword || undefined, spaceId: submittedParams.spaceId, actorId: submittedParams.actorId,
    action: submittedParams.action, ...formatDateTimeRangeForApi(submittedParams.timeRange),
  };
  const query = useDriveAdminActivities({ page, pageSize, ...listParams });
  const spacesQuery = useDriveSpaceList({ page: 1, pageSize: 200 });

  const columns: ColumnProps<DriveActivity>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '操作人', dataIndex: 'actorName', width: 110, render: (v: string | null, a: DriveActivity) => renderEllipsis(v ?? (a.shareId ? '外链访客' : null)) },
    { title: '动作', dataIndex: 'action', width: 110, render: (v: DriveActivityAction) => <Tag size="small" color={DANGER_ACTIONS.includes(v) ? 'orange' : 'blue'}>{DRIVE_ACTIVITY_ACTION_LABELS[v]}</Tag> },
    { title: '对象', dataIndex: 'nodeName', minWidth: 220, ellipsis: { showTitle: false },
      render: (_: unknown, a: DriveActivity) => (
        <FileNameCell name={a.nodeName} mimeType={a.nodeType === 'folder' ? 'inode/directory' : null}
          onClick={a.nodeId ? () => navigate(`/drive?space=${a.spaceId}`) : undefined} />
      ) },
    { title: '空间', dataIndex: 'spaceName', width: 140, render: renderEllipsis },
    { title: '详情', dataIndex: 'detail', width: 220, render: (v: DriveActivity['detail']) => renderEllipsis(describeActivityDetail(v)) },
    { title: 'IP', dataIndex: 'clientIp', width: 140, render: renderEllipsis },
  ];

  const exportButton = (variant?: 'flat') => (
    <ExportButton entity="drive.activities" permission="drive:admin:activity:export" variant={variant} query={listParams as Record<string, unknown>} />
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <KeywordInput value={draftParams.keyword} placeholder="搜索文件名" onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
            <FilterSelect<number> value={draftParams.spaceId} placeholder="全部空间" width={160}
              items={(spacesQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setDraftParams((p) => ({ ...p, spaceId: v }))} />
          </>
        )}
        filters={(
          <>
            <UserSelect value={draftParams.actorId} onChange={(v) => setDraftParams((p) => ({ ...p, actorId: typeof v === 'number' ? v : undefined }))} placeholder="全部操作人" style={{ width: 160 }} />
            <FilterSelect<DriveActivityAction> value={draftParams.action} placeholder="全部动作" width={140} items={DRIVE_ACTIVITY_ACTION_OPTIONS} onChange={(v) => setDraftParams((p) => ({ ...p, action: v }))} />
            <DateRangeFilter value={draftParams.timeRange} onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))} />
          </>
        )}
        actions={(<><SearchButton onClick={handleSearch} /><ResetButton onClick={handleReset} />{exportButton()}</>)}
        mobilePrimary={(
          <>
            <KeywordInput value={draftParams.keyword} placeholder="搜索文件名" onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} width={200} />
            <SearchButton onClick={handleSearch} />
          </>
        )}
        mobileFilters={(
          <>
            <FilterSelect<number> value={draftParams.spaceId} placeholder="全部空间" width={160}
              items={(spacesQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name }))} onChange={(v) => setDraftParams((p) => ({ ...p, spaceId: v }))} />
            <UserSelect value={draftParams.actorId} onChange={(v) => setDraftParams((p) => ({ ...p, actorId: typeof v === 'number' ? v : undefined }))} placeholder="全部操作人" style={{ width: 160 }} />
            <FilterSelect<DriveActivityAction> value={draftParams.action} placeholder="全部动作" width={140} items={DRIVE_ACTIVITY_ACTION_OPTIONS} onChange={(v) => setDraftParams((p) => ({ ...p, action: v }))} />
            <DateRangeFilter value={draftParams.timeRange} onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))} />
          </>
        )}
        mobileActions={exportButton('flat')}
        filterTitle="动态审计筛选"
        actionTitle="动态审计操作"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      <ConfigurableTable<DriveActivity> bordered rowKey="id" columns={columns} dataSource={query.data?.list ?? []}
        loading={query.isFetching} onRefresh={() => void query.refetch()} refreshLoading={query.isFetching}
        pagination={buildPagination(query.data?.total ?? 0)} />
      {query.data?.total === 0 && <Typography.Text type="tertiary">暂无动态记录。</Typography.Text>}
    </div>
  );
}
