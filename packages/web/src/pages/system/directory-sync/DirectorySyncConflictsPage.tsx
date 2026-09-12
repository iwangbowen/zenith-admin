import { useMemo, useState } from 'react';
import { Button, Form, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ListChecks } from 'lucide-react';
import { ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import AppModal from '@/components/AppModal';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import {
  directorySyncConflictKeys, useDirectorySyncConflictList,
  useResolveDirectorySyncConflict, useIgnoreDirectorySyncConflicts,
  useDirectorySyncSourceList,
} from '@/hooks/queries/directory-sync';
import { useAllUsers } from '@/hooks/queries/users';
import type { DirectorySyncConflict, DirectorySyncResolution } from '@zenith/shared/identity';
import { enumValueOf } from '@zenith/shared/core';
import {
  DIRECTORY_SYNC_CONFLICT_STATUSES, DIRECTORY_SYNC_CONFLICT_STATUS_LABELS,
  DIRECTORY_SYNC_CONFLICT_TYPE_LABELS, DIRECTORY_SYNC_ENTITY_TYPE_LABELS,
} from '@zenith/shared/identity';

interface SearchParams {
  keyword: string;
  sourceId?: number;
  status?: string;
}

// 默认只看待裁决
const defaultSearchParams: SearchParams = { keyword: '', sourceId: undefined, status: 'pending' };

const CONFLICT_STATUS_TAG_COLOR: Record<string, 'orange' | 'green' | 'grey'> = {
  pending: 'orange',
  resolved: 'green',
  ignored: 'grey',
};

function renderDataPreview(data: Record<string, unknown> | null) {
  if (!data || Object.keys(data).length === 0) return EMPTY_PLACEHOLDER;
  const entries = Object.entries(data).filter(([k]) => k !== 'deptExternalIds' && k !== 'userId');
  if (entries.length === 0) return EMPTY_PLACEHOLDER;
  return (
    <div>
      {entries.map(([field, value]) => (
        <div key={field} style={{ fontSize: 12 }}>
          <Typography.Text type="tertiary" size="small">{field}：</Typography.Text>
          <Typography.Text size="small">{String(value ?? '空')}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

export default function DirectorySyncConflictsPage() {
  const { hasPermission } = usePermission();
  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection<number, DirectorySyncConflict>({
    // 只有挂起中的冲突可参与批量忽略
    extra: { getCheckboxProps: (record?: DirectorySyncConflict) => ({ disabled: record?.status !== 'pending' }) },
  });

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: directorySyncConflictKeys.lists,
    onSearch: clearSelection,
    onReset: clearSelection,
  });

  const listQuery = useDirectorySyncConflictList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    sourceId: submittedParams.sourceId,
    status: enumValueOf(DIRECTORY_SYNC_CONFLICT_STATUSES, submittedParams.status),
  });

  const sourcesQuery = useDirectorySyncSourceList({ page: 1, pageSize: 100 });
  const sourceItems = useMemo(
    () => (sourcesQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name })),
    [sourcesQuery.data],
  );

  const resolveMutation = useResolveDirectorySyncConflict();
  const ignoreMutation = useIgnoreDirectorySyncConflicts();

  // ─── 裁决弹窗（非 useEditModal：不是实体编辑表单，提交后关闭并清理本地状态）────
  const [resolving, setResolving] = useState<DirectorySyncConflict | null>(null);
  const [resolution, setResolution] = useState<DirectorySyncResolution>('source');
  const [targetUserId, setTargetUserId] = useState<number | undefined>(undefined);
  const usersQuery = useAllUsers({ enabled: resolving?.conflictType === 'multi_match' });
  const candidateOptions = useMemo(() => {
    if (!resolving) return [];
    const users = usersQuery.data ?? [];
    return resolving.candidateUserIds.map((id) => {
      const user = users.find((u) => u.id === id);
      return { value: id, label: user ? `${user.nickname}（${user.username}）` : `用户 #${id}` };
    });
  }, [resolving, usersQuery.data]);

  function openResolve(record: DirectorySyncConflict) {
    setResolution('source');
    setTargetUserId(undefined);
    setResolving(record);
  }

  function handleResolveSubmit() {
    if (!resolving) return;
    if (resolving.conflictType === 'multi_match' && resolution === 'source' && !targetUserId) {
      Toast.warning('请选择要绑定的本地账号');
      return;
    }
    resolveMutation.mutate(
      { params: { id: resolving.id }, body: { resolution, targetUserId } },
      {
        onSuccess: () => {
          Toast.success('裁决成功');
          setResolving(null);
        },
      },
    );
  }

  function handleIgnore(ids: number[]) {
    ignoreMutation.mutate({ body: { ids } }, {
      onSuccess: () => {
        Toast.success(`已忽略 ${ids.length} 条冲突`);
        clearSelection();
      },
    });
  }

  const columns: ColumnProps<DirectorySyncConflict>[] = [
    { title: '同步源', dataIndex: 'sourceName', width: 130, render: renderEllipsis },
    {
      title: '对象', dataIndex: 'name', minWidth: 150,
      render: (_: unknown, r: DirectorySyncConflict) => (
        <div>
          <div>{r.name ?? EMPTY_PLACEHOLDER}</div>
          <Typography.Text type="tertiary" size="small">{DIRECTORY_SYNC_ENTITY_TYPE_LABELS[r.entityType]} · {r.externalId}</Typography.Text>
        </div>
      ),
    },
    {
      title: '冲突类型', dataIndex: 'conflictType', width: 150,
      render: (_: unknown, r: DirectorySyncConflict) => DIRECTORY_SYNC_CONFLICT_TYPE_LABELS[r.conflictType] ?? r.conflictType,
    },
    {
      title: '源侧数据', dataIndex: 'sourceData', width: 200,
      render: (_: unknown, r: DirectorySyncConflict) => renderDataPreview(r.sourceData),
    },
    {
      title: '本地数据', dataIndex: 'localData', width: 200,
      render: (_: unknown, r: DirectorySyncConflict) => r.conflictType === 'multi_match'
        ? <Typography.Text type="tertiary" size="small">候选账号 {r.candidateUserIds.length} 个</Typography.Text>
        : renderDataPreview(r.localData),
    },
    dateTimeColumn('发现时间', 'createdAt'),
    {
      title: '裁决', dataIndex: 'resolvedByNickname', width: 130,
      render: (_: unknown, r: DirectorySyncConflict) => r.status === 'pending'
        ? EMPTY_PLACEHOLDER
        : <Typography.Text size="small">{r.resolvedByNickname ?? EMPTY_PLACEHOLDER}</Typography.Text>,
    },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (_: unknown, r: DirectorySyncConflict) => (
        <Tag color={CONFLICT_STATUS_TAG_COLOR[r.status] ?? 'grey'}>{DIRECTORY_SYNC_CONFLICT_STATUS_LABELS[r.status]}</Tag>
      ),
    },
    createOperationColumn<DirectorySyncConflict>({
      width: 150,
      actions: (record) => record.status !== 'pending' ? [] : [
        ...(hasPermission('system:dirsync-conflict:resolve') ? [{
          key: 'resolve', label: '裁决', onClick: () => openResolve(record),
        }] : []),
        ...(hasPermission('system:dirsync-conflict:ignore') ? [{
          key: 'ignore', label: '忽略', onClick: () => handleIgnore([record.id]),
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索姓名 / 外部 ID..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={(
          <>
            <FilterSelect<number>
              placeholder="全部同步源"
              width={160}
              items={sourceItems}
              {...bind('sourceId')}
            />
            <StatusSelect

              items={DIRECTORY_SYNC_CONFLICT_STATUSES.map((s) => ({ value: s, label: DIRECTORY_SYNC_CONFLICT_STATUS_LABELS[s] }))}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={selectedRowKeys.length > 0 && hasPermission('system:dirsync-conflict:ignore') && (
          <Button theme="light" icon={<ListChecks size={14} />} onClick={() => handleIgnore(selectedRowKeys)}>
            批量忽略 ({selectedRowKeys.length})
          </Button>
        )}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<DirectorySyncConflict>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无冲突，同步产生的挂起项会出现在这里',
          rowSelection,
        })}
      />

      <AppModal
        title="裁决冲突"
        visible={resolving !== null}
        onCancel={() => setResolving(null)}
        onOk={handleResolveSubmit}
        okButtonProps={{ loading: resolveMutation.isPending }}
        closeOnEsc
        width={520}
      >
        {resolving && (
          <Spin spinning={resolving.conflictType === 'multi_match' && usersQuery.isFetching}>
            <div style={{ marginBottom: 12 }}>
              <Typography.Text type="tertiary">
                {DIRECTORY_SYNC_CONFLICT_TYPE_LABELS[resolving.conflictType]}：{resolving.name ?? resolving.externalId}
              </Typography.Text>
            </div>
            <Form labelPosition="left" labelWidth={90}>
              <Form.RadioGroup
                field="resolution"
                label="处理方式"
                initValue={resolution}
                onChange={(e) => setResolution(e.target.value as DirectorySyncResolution)}
                options={resolving.conflictType === 'multi_match'
                  ? [
                    { label: '绑定到指定本地账号（采用源数据）', value: 'source' },
                    { label: '保持现状（不绑定）', value: 'local' },
                  ]
                  : [
                    { label: '采用源侧值（覆盖本地修改）', value: 'source' },
                    { label: '保留本地值', value: 'local' },
                  ]}
              />
              {resolving.conflictType === 'multi_match' && resolution === 'source' && (
                <Form.Slot label="绑定账号">
                  <FilterSelect
                    placeholder="全部本地账号"
                    width={280}
                    items={candidateOptions.map((o) => ({ value: String(o.value), label: o.label }))}
                    value={targetUserId ? String(targetUserId) : ''}
                    onChange={(v) => setTargetUserId(v ? Number(v) : undefined)}
                  />
                </Form.Slot>
              )}
            </Form>
          </Spin>
        )}
      </AppModal>
    </div>
  );
}
