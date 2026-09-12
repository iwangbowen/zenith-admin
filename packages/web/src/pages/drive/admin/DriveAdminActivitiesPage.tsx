import { useMemo } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useNavigate } from 'react-router-dom';
import { DRIVE_ACTIVITY_ACTION_LABELS, DRIVE_ACTIVITY_ACTION_OPTIONS, type DriveActivity, type DriveActivityAction } from '@zenith/shared/drive';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { FileNameCell } from '@/components/FileNameCell';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import UserSelect from '@/components/UserSelect';
import { useListSearch } from '@/hooks/useListSearch';
import { driveKeys, useDriveAdminActivities, useDriveSpaceList } from '@/hooks/queries/drive';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { describeActivityDetail } from '../drive-utils';
import { compactParams } from '@/lib/query';

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
  const { page, pageSize, buildPagination, bind, bindKeyword, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', spaceId: undefined, actorId: undefined, action: undefined, timeRange: null }, listKey: driveKeys.adminActivitiesPrefix });
  // 已提交筛选 → 契约查询参数：列表与导出共用同一份映射
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    spaceId: submittedParams.spaceId,
    actorId: submittedParams.actorId,
    action: submittedParams.action,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);
  const query = useDriveAdminActivities({ page, pageSize, ...filterQuery });
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
    <ExportButton entity="drive.activities" permission="drive:admin:activity:export" variant={variant} query={filterQuery} />
  );

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <KeywordInput {...bindKeyword('keyword')} placeholder="搜索文件名" />
            <FilterSelect<number> {...bind('spaceId')} placeholder="全部空间" width={160}
              items={(spacesQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          </>
        )}
        filters={(
          <>
            <UserSelect {...bind('actorId', (v) => typeof v === 'number' ? v : undefined)} placeholder="全部操作人" style={{ width: 160 }} />
            <FilterSelect<DriveActivityAction> {...bind('action')} placeholder="全部动作" width={140} items={DRIVE_ACTIVITY_ACTION_OPTIONS} />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={exportButton()}
        filterTitle="动态审计筛选"
        actionTitle="动态审计操作"
      />
      <ConfigurableTable<DriveActivity> columns={columns}
        {...listTableProps(query, { pagination: buildPagination })}
      />
      {query.data?.total === 0 && <Typography.Text type="tertiary">暂无动态记录。</Typography.Text>}
    </div>
  );
}
