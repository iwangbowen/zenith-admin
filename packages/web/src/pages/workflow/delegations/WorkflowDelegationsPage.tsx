import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Modal,
  Select,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { WorkflowDelegation } from '@zenith/shared';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useWorkflowDefinitionList } from '@/hooks/queries/workflow-definitions';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useDeleteWorkflowDelegation,
  useSaveWorkflowDelegation,
  useWorkflowDelegationList,
  workflowDelegationKeys,
} from '@/hooks/queries/workflow-delegations';

type Scope = 'mine' | 'all';

interface SearchParams {
  scope: Scope;
}

const defaultSearchParams: SearchParams = { scope: 'mine' };

interface FormValues extends Record<string, unknown> {
  principalId?: number | null;
  delegateId?: number | null;
  definitionId?: number | null;
  startAt?: Date | null;
  endAt?: Date | null;
  reason?: string | null;
  enabled?: boolean;
}

function renderDelegationStatus(record: WorkflowDelegation) {
  if (record.active) return <Tag color="green">生效中</Tag>;
  if (!record.enabled) return <Tag color="grey">已停用</Tag>;
  const now = new Date();
  if (record.startAt && new Date(record.startAt.replace(' ', 'T')) > now) {
    return <Tag color="grey">未到生效期</Tag>;
  }
  if (record.endAt && new Date(record.endAt.replace(' ', 'T')) < now) {
    return <Tag color="grey">已过期</Tag>;
  }
  return <Tag color="grey">未生效</Tag>;
}

export default function WorkflowDelegationsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi<FormValues> | null>(null);

  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useWorkflowDelegationList({ page, pageSize, scope: submittedParams.scope });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowDelegation | null>(null);

  const usersQuery = useAllUsers();
  const definitionsQuery = useWorkflowDefinitionList({ page: 1, pageSize: 200 });
  const saveMutation = useSaveWorkflowDelegation();
  const deleteMutation = useDeleteWorkflowDelegation();

  const canManage = hasPermission('workflow:delegation:manage');

  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id })),
    [usersQuery.data],
  );

  const defOptions = useMemo(
    () => (definitionsQuery.data?.list ?? []).map((d) => ({ value: d.id, label: d.name })),
    [definitionsQuery.data],
  );

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowDelegationKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowDelegationKeys.lists });
  };

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
    setTimeout(() => {
      formApi.current?.setValues({
        principalId: undefined,
        delegateId: undefined,
        definitionId: undefined,
        startAt: null,
        endAt: null,
        reason: '',
        enabled: true,
      });
    }, 0);
  };

  const openEdit = (row: WorkflowDelegation) => {
    setEditing(row);
    setModalVisible(true);
    setTimeout(() => {
      formApi.current?.setValues({
        principalId: row.principalId,
        delegateId: row.delegateId,
        definitionId: row.definitionId ?? undefined,
        startAt: row.startAt ? new Date(row.startAt.replace(' ', 'T')) : null,
        endAt: row.endAt ? new Date(row.endAt.replace(' ', 'T')) : null,
        reason: row.reason ?? '',
        enabled: row.enabled,
      });
    }, 0);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const handleSubmit = async (vals: FormValues) => {
    const body = {
      ...(canManage && vals.principalId != null ? { principalId: Number(vals.principalId) } : {}),
      delegateId: Number(vals.delegateId),
      definitionId: vals.definitionId != null ? Number(vals.definitionId) : null,
      startAt: vals.startAt ? formatDateTimeForApi(vals.startAt as Date) : null,
      endAt: vals.endAt ? formatDateTimeForApi(vals.endAt as Date) : null,
      reason: typeof vals.reason === 'string' && vals.reason.trim() ? vals.reason.trim() : null,
      enabled: vals.enabled ?? true,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: body });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const handleModalOk = async () => {
    let values: FormValues;
    try {
      values = await formApi.current!.validate();
    } catch {
      throw new Error('validation');
    }
    await handleSubmit(values);
  };

  const columns: ColumnProps<WorkflowDelegation>[] = [
    {
      title: '委托人',
      dataIndex: 'principalName',
      width: 130,
      render: (_v: unknown, r: WorkflowDelegation) => r.principalName ?? `#${r.principalId}`,
    },
    {
      title: '代理人',
      dataIndex: 'delegateName',
      width: 130,
      render: (_v: unknown, r: WorkflowDelegation) => r.delegateName ?? `#${r.delegateId}`,
    },
    {
      title: '适用流程',
      dataIndex: 'definitionName',
      width: 180,
      render: (_v: unknown, r: WorkflowDelegation) =>
        r.definitionId == null ? '全部流程' : (r.definitionName ?? `#${r.definitionId}`),
    },
    {
      title: '生效时间',
      dataIndex: 'startAt',
      width: 260,
      render: (_v: unknown, r: WorkflowDelegation) => {
        const start = r.startAt ? formatDateTime(r.startAt) : '立即';
        const end = r.endAt ? formatDateTime(r.endAt) : '长期';
        return `${start} ~ ${end}`;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'active',
      width: 100,
      fixed: 'right',
      render: (_v: unknown, r: WorkflowDelegation) => renderDelegationStatus(r),
    },
    createOperationColumn<WorkflowDelegation>({
      width: 130,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canManage,
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: '确定删除该审批代理？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderScopeFilter = () => (
    <Select
      placeholder="数据范围"
      value={draftParams.scope}
      onChange={(v) =>
      setDraftParams((prev) => ({ ...prev, scope: (v as Scope) ?? 'mine' }))
      }
      style={{ width: 140 }}
      optionList={[
        { value: 'mine', label: '我的' },
        { value: 'all', label: '全部' },
      ]}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
      查询
    </Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
      重置
    </Button>
  );

  const renderCreateButton = () => canManage ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
      新增
    </Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderScopeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderScopeFilter()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        filterTitle="审批代理筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable<WorkflowDelegation>
        bordered
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total)}
      />

      {canManage && (
        <AppModal
          title={editing ? '编辑审批代理' : '新增审批代理'}
          visible={modalVisible}
          onCancel={() => {
            setModalVisible(false);
            setEditing(null);
          }}
          onOk={handleModalOk}
          confirmLoading={saveMutation.isPending}
          closeOnEsc
          width={560}
        >
          <Form<FormValues>
            getFormApi={(api) => {
              formApi.current = api;
            }}
            onSubmit={handleSubmit}
            labelPosition="left"
            labelWidth={90}
          >
            {canManage && (
              <Form.Select
                field="principalId"
                label="委托人"
                style={{ width: '100%' }}
                optionList={userOptions}
                filter
                showClear
                placeholder="不选则默认当前用户"
              />
            )}
            <Form.Select
              field="delegateId"
              label="代理人"
              style={{ width: '100%' }}
              optionList={userOptions}
              filter
              rules={[{ required: true, message: '请选择代理人' }]}
            />
            <Form.Select
              field="definitionId"
              label="适用流程"
              style={{ width: '100%' }}
              optionList={defOptions}
              filter
              showClear
              placeholder="不选则对全部流程生效"
            />
            <Form.DatePicker
              field="startAt"
              label="生效开始"
              type="dateTime"
              style={{ width: '100%' }}
              placeholder="不填则立即生效"
            />
            <Form.DatePicker
              field="endAt"
              label="生效结束"
              type="dateTime"
              style={{ width: '100%' }}
              placeholder="不填则长期有效"
            />
            <Form.Input
              field="reason"
              label="原因"
              placeholder="可选"
              maxLength={255}
            />
            <Form.Switch field="enabled" label="启用" initValue={true} />
          </Form>
        </AppModal>
      )}
    </div>
  );
}
