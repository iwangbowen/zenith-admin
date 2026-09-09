/**
 * 数据导入中心：导入历史列表（任务中心 data-import 过滤视图）+「新建导入」统一入口。
 * 与导出中心页对偶：筛选工具栏 + 表格为主体，实体选择收进新建弹窗。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { AsyncTask, ImportEntityMeta } from '@zenith/shared/tasks';
import { ASYNC_TASK_STATUSES } from '@zenith/shared/tasks';
import { enumValueOf } from '@zenith/shared/core';
import { ImportProgressModal } from '@/components/ImportButton';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListSearchToolbar } from '@/components/list-page';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { dateTimeColumn } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { useImportEntities } from '@/hooks/queries/import-jobs';
import { asyncTaskKeys, useAsyncTaskList } from '@/hooks/queries/async-tasks';
import NewImportModal from './NewImportModal';

const { Text } = Typography;

interface SearchParams {
  entity?: string;
  status?: string;
  keyword: string;
}

const defaultSearchParams: SearchParams = { entity: undefined, status: undefined, keyword: '' };
const EMPTY_ENTITIES: ImportEntityMeta[] = [];
const EMPTY_TASKS: AsyncTask[] = [];

const TASK_STATUS_META = {
  pending: { label: '排队中', color: 'grey' },
  running: { label: '执行中', color: 'blue' },
  success: { label: '成功', color: 'green' },
  failed: { label: '失败', color: 'red' },
  cancelled: { label: '已取消', color: 'grey' },
} as const satisfies Record<AsyncTask['status'], { label: string; color: string }>;

const statusOptions = [
  { value: 'pending', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];

/** 从任务 payload 提取实体标识与预检标记 */
function parsePayload(task: AsyncTask): { entity: string | null; dryRun: boolean } {
  const payload = task.payload as { entity?: string; dryRun?: boolean } | null;
  return { entity: payload?.entity ?? null, dryRun: Boolean(payload?.dryRun) };
}

export default function ImportCenterPage() {
  const qc = useQueryClient();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: asyncTaskKeys.lists });

  const [newImportVisible, setNewImportVisible] = useState(false);
  const [hasActiveTask, setHasActiveTask] = useState(false);
  /** 进度弹窗当前查看的任务（新提交或历史行「查看明细」） */
  const [progressTask, setProgressTask] = useState<{ id: number; title: string } | null>(null);

  const entitiesQuery = useImportEntities();
  const entities = entitiesQuery.data ?? EMPTY_ENTITIES;
  const entityMap = useMemo(() => new Map(entities.map((e) => [e.entity, e])), [entities]);

  const listQuery = useAsyncTaskList(
    {
      page, pageSize, taskType: 'data-import',
      status: enumValueOf(ASYNC_TASK_STATUSES, submittedParams.status),
      keyword: submittedParams.keyword || undefined,
      // 实体标识存于任务 payload，走内容匹配筛选
      content: submittedParams.entity || undefined,
    },
    // 有进行中的任务时轮询列表（渲染期重新求值，任务终态后自动停止）
    { refetchInterval: hasActiveTask ? 3000 : false },
  );
  const list = listQuery.data?.list ?? EMPTY_TASKS;
  const total = listQuery.data?.total ?? 0;

  useEffect(() => {
    setHasActiveTask(list.some((t) => t.status === 'pending' || t.status === 'running'));
  }, [list]);

  const entityOptions = useMemo(() => {
    const byModule = new Map<string, ImportEntityMeta[]>();
    for (const e of entities) {
      const group = byModule.get(e.module) ?? [];
      group.push(e);
      byModule.set(e.module, group);
    }
    return [...byModule.entries()];
  }, [entities]);

  const columns: ColumnProps<AsyncTask>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '任务', dataIndex: 'title', minWidth: 280, ellipsis: { showTitle: false }, render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v}</Text> },
    {
      title: '实体', width: 110,
      render: (_: unknown, r: AsyncTask) => {
        const { entity } = parsePayload(r);
        if (!entity) return '—';
        return entityMap.get(entity)?.title ?? entity;
      },
    },
    {
      title: '模式', width: 80,
      render: (_: unknown, r: AsyncTask) => parsePayload(r).dryRun
        ? <Tag size="small" color="orange">预检</Tag>
        : <Tag size="small" color="light-blue">导入</Tag>,
    },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: AsyncTask['status']) => {
        const meta = TASK_STATUS_META[v] ?? { label: v, color: 'grey' as const };
        return <Tag size="small" color={meta.color as 'grey'}>{meta.label}</Tag>;
      },
    },
    {
      title: '进度', width: 220,
      render: (_: unknown, r: AsyncTask) => <AsyncTaskProgress task={r} noteDisplay="tooltip" />,
    },
    { title: '提交人', dataIndex: 'createdByName', width: 110, render: (v: string | null) => v ?? '—' },
    dateTimeColumn('提交时间', 'createdAt'),
    createOperationColumn<AsyncTask>({
      width: 120,
      desktopInlineKeys: ['detail'],
      actions: (record) => [
        {
          key: 'detail',
          label: '查看明细',
          onClick: () => {
            const { entity } = parsePayload(record);
            setProgressTask({ id: record.id, title: entityMap.get(entity ?? '')?.title ?? '数据' });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索任务名/文件名"
            {...bindKeyword('keyword')}
            width={220}
          />
        )}
        filters={(
          <>
            <FilterSelect
              placeholder="全部导入实体"
              groups={entityOptions.map(([module, items]) => ({ label: module, items: items.map((e) => ({ value: e.entity, label: e.title })) }))}
              {...bind('entity')}
              width={160}
            />
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton onClick={() => setNewImportVisible(true)}>新建导入</CreateButton>}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching && !listQuery.data}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowKey="id"
        size="small"
        empty="暂无导入记录，点击「新建导入」开始"
      />

      <NewImportModal
        visible={newImportVisible}
        entities={entities}
        entitiesLoading={entitiesQuery.isPending}
        onClose={() => setNewImportVisible(false)}
        onSubmitted={(taskId, title) => {
          setNewImportVisible(false);
          setProgressTask({ id: taskId, title });
        }}
      />

      <ImportProgressModal
        taskId={progressTask?.id ?? null}
        title={progressTask?.title ?? '数据'}
        onClose={() => setProgressTask(null)}
        onFinished={() => void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists })}
      />
    </div>
  );
}
