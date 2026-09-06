import { useMemo, useState } from 'react';
import { SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { DateRangeFilter, FilterSelect, StatusSelect } from '@/components/search-filters';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeRangeForApi } from '@/utils/date';
import {
  directorySyncRunKeys, useDirectorySyncRunList, useDirectorySyncRunItems,
  useRetryDirectorySyncRun, useDirectorySyncSourceList,
} from '@/hooks/queries/directory-sync';
import type { DirectorySyncRun, DirectorySyncRunItem } from '@zenith/shared/identity';
import { enumValueOf } from '@zenith/shared/core';
import {
  DIRECTORY_SYNC_RUN_STATUSES, DIRECTORY_SYNC_RUN_STATUS_LABELS,
  DIRECTORY_SYNC_TRIGGER_TYPE_LABELS,
  DIRECTORY_SYNC_ITEM_ACTIONS, DIRECTORY_SYNC_ITEM_ACTION_LABELS,
  DIRECTORY_SYNC_ENTITY_TYPE_LABELS,
} from '@zenith/shared/identity';

interface SearchParams {
  sourceId?: string;
  status?: string;
  timeRange: [Date, Date] | null;
}

const defaultSearchParams: SearchParams = { sourceId: undefined, status: undefined, timeRange: null };

const RUN_STATUS_TAG_COLOR: Record<string, 'green' | 'red' | 'orange' | 'blue' | 'grey'> = {
  success: 'green',
  partial: 'orange',
  failed: 'red',
  aborted: 'red',
  running: 'blue',
};

const ITEM_ACTION_TAG_COLOR: Record<string, 'green' | 'red' | 'orange' | 'blue' | 'grey' | 'cyan'> = {
  create: 'green',
  update: 'blue',
  link: 'cyan',
  disable: 'orange',
  skip: 'grey',
  conflict: 'orange',
  fail: 'red',
};

function renderDiff(diff: DirectorySyncRunItem['diff']) {
  if (!diff || Object.keys(diff).length === 0) return EMPTY_PLACEHOLDER;
  return (
    <div>
      {Object.entries(diff).map(([field, delta]) => (
        <div key={field} style={{ fontSize: 12 }}>
          <Typography.Text type="tertiary" size="small">{field}：</Typography.Text>
          <Typography.Text type="danger" size="small" delete>{String(delta.from ?? '空')}</Typography.Text>
          <Typography.Text size="small"> → {String(delta.to ?? '空')}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

export default function DirectorySyncLogsPage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: directorySyncRunKeys.lists });

  const listQuery = useDirectorySyncRunList({
    page,
    pageSize,
    sourceId: submittedParams.sourceId ? Number(submittedParams.sourceId) : undefined,
    status: enumValueOf(DIRECTORY_SYNC_RUN_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });

  // 源筛选下拉：复用同步源列表查询
  const sourcesQuery = useDirectorySyncSourceList({ page: 1, pageSize: 100 });
  const sourceItems = useMemo(
    () => (sourcesQuery.data?.list ?? []).map((s) => ({ value: String(s.id), label: s.name })),
    [sourcesQuery.data],
  );

  const retryMutation = useRetryDirectorySyncRun();

  // ─── 差异明细抽屉 ─────────────────────────────────────────────────────────
  const [detailRun, setDetailRun] = useState<DirectorySyncRun | null>(null);
  const [itemAction, setItemAction] = useState<string | undefined>();
  const itemsPagination = usePagination(20);
  const itemsQuery = useDirectorySyncRunItems(
    detailRun?.id,
    { page: itemsPagination.page, pageSize: itemsPagination.pageSize, action: enumValueOf(DIRECTORY_SYNC_ITEM_ACTIONS, itemAction) },
    detailRun !== null,
  );

  function openDetail(run: DirectorySyncRun) {
    setItemAction('');
    itemsPagination.resetPage();
    setDetailRun(run);
  }

  function handleRetry(run: DirectorySyncRun) {
    retryMutation.mutate({ params: { id: run.id } }, {
      onSuccess: () => Toast.success('重试任务已提交，将对该源重新执行一次同步'),
    });
  }

  const columns: ColumnProps<DirectorySyncRun>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '同步源', dataIndex: 'sourceName', minWidth: 150, render: renderEllipsis },
    {
      title: '触发方式', dataIndex: 'triggerType', width: 90,
      render: (_: unknown, r: DirectorySyncRun) => DIRECTORY_SYNC_TRIGGER_TYPE_LABELS[r.triggerType] ?? r.triggerType,
    },
    {
      title: '模式', dataIndex: 'dryRun', width: 80,
      render: (v: boolean) => v ? <Tag color="grey">预览</Tag> : <Tag color="blue">同步</Tag>,
    },
    {
      title: '结果统计', dataIndex: 'message', width: 320,
      render: (_: unknown, r: DirectorySyncRun) => (
        <span style={{ fontSize: 12 }}>
          新增 {r.userCreated} / 绑定 {r.userLinked} / 更新 {r.userUpdated} / 禁用 {r.userDisabled}
          {r.deptCreated + r.deptUpdated > 0 ? ` / 部门 +${r.deptCreated}~${r.deptUpdated}` : ''}
          {r.conflictCount > 0 ? ` / 冲突 ${r.conflictCount}` : ''}
          {r.failedCount > 0 ? ` / 失败 ${r.failedCount}` : ''}
        </span>
      ),
    },
    dateTimeColumn('开始时间', 'startedAt'),
    dateTimeColumn('结束时间', 'finishedAt'),
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (_: unknown, r: DirectorySyncRun) => (
        <Tag color={RUN_STATUS_TAG_COLOR[r.status] ?? 'grey'}>{DIRECTORY_SYNC_RUN_STATUS_LABELS[r.status]}</Tag>
      ),
    },
    createOperationColumn<DirectorySyncRun>({
      width: 220,
      actions: (record) => [
        ...(hasPermission('system:dirsync-log:detail') ? [{
          key: 'detail', label: '查看差异', onClick: () => openDetail(record),
        }] : []),
        ...(hasPermission('system:dirsync-log:retry') && record.failedCount > 0 && record.status !== 'running' ? [{
          key: 'retry', label: '重试失败项', onClick: () => handleRetry(record),
        }] : []),
      ],
    }),
  ];

  const itemColumns: ColumnProps<DirectorySyncRunItem>[] = [
    {
      title: '对象', dataIndex: 'entityType', width: 80,
      render: (_: unknown, r: DirectorySyncRunItem) => DIRECTORY_SYNC_ENTITY_TYPE_LABELS[r.entityType] ?? r.entityType,
    },
    { title: '名称', dataIndex: 'name', width: 140, render: renderEllipsis },
    { title: '外部 ID', dataIndex: 'externalId', width: 160, render: renderEllipsis },
    {
      title: '动作', dataIndex: 'action', width: 80,
      render: (_: unknown, r: DirectorySyncRunItem) => (
        <Tag color={ITEM_ACTION_TAG_COLOR[r.action] ?? 'grey'}>{DIRECTORY_SYNC_ITEM_ACTION_LABELS[r.action]}</Tag>
      ),
    },
    {
      title: '字段变更', dataIndex: 'diff', width: 240,
      render: (_: unknown, r: DirectorySyncRunItem) => renderDiff(r.diff),
    },
    { title: '说明', dataIndex: 'message', width: 200, render: renderEllipsis },
  ];

  const renderSourceFilter = () => (
    <FilterSelect
      placeholder="全部同步源"
      width={160}
      items={sourceItems}
      value={draftParams.sourceId}
      onChange={(v) => setDraftParams((p) => ({ ...p, sourceId: v }))}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={DIRECTORY_SYNC_RUN_STATUSES.map((s) => ({ value: s, label: DIRECTORY_SYNC_RUN_STATUS_LABELS[s] }))}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );

  const renderTimeRangeFilter = () => (
    <DateRangeFilter
      value={draftParams.timeRange}
      onChange={(v) => setDraftParams((p) => ({ ...p, timeRange: v }))}
    />
  );

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={(
          <>
            {renderSourceFilter()}
            {renderStatusFilter()}
            {renderTimeRangeFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<DirectorySyncRun>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无同步记录',
        })}
      />

      <SideSheet
        title={detailRun ? `差异明细 #${detailRun.id}（${detailRun.sourceName ?? ''}${detailRun.dryRun ? ' · 预览' : ''}）` : '差异明细'}
        visible={detailRun !== null}
        onCancel={() => setDetailRun(null)}
        width={760}
        closeOnEsc
      >
        {detailRun && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Typography.Text type="tertiary">{detailRun.message ?? ''}</Typography.Text>
            </div>
            <div style={{ marginBottom: 12 }}>
              <FilterSelect
                placeholder="全部动作"
                items={DIRECTORY_SYNC_ITEM_ACTIONS.map((a) => ({ value: a, label: DIRECTORY_SYNC_ITEM_ACTION_LABELS[a] }))}
                value={itemAction}
                onChange={(v) => {
                  setItemAction(v);
                  itemsPagination.resetPage();
                }}
              />
            </div>
            <ConfigurableTable<DirectorySyncRunItem>
              columns={itemColumns}
              {...listTableProps(itemsQuery, {
                pagination: itemsPagination.buildPagination,
                empty: '该记录没有差异明细',
              })}
            />
          </>
        )}
      </SideSheet>
    </div>
  );
}
