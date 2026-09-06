import { useMemo } from 'react';
import { Form, Select, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowDelegation } from '@zenith/shared/workflow';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useWorkflowDefinitionList } from '@/hooks/queries/workflow-definitions';
import { useWorkflowSelectableUsers } from '@/hooks/queries/workflow-shared';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useDeleteWorkflowDelegations,
  useSaveWorkflowDelegation,
  useWorkflowDelegationList,
  workflowDelegationKeys,
} from '@/hooks/queries/workflow-delegations';
import { CreateButton } from '@/components/toolbar-controls';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { useEditModal } from '@/hooks/useEditModal';
import { dateTimeColumn } from '@/utils/table-columns';

type Scope = 'mine' | 'all';

interface SearchParams {
  scope: Scope;
}

const defaultSearchParams: SearchParams = { scope: 'mine' };

interface FormValues extends Record<string, unknown> {
  principalId?: number | null;
  delegateId?: number | null;
  definitionId?: number | null;
  mode?: 'full' | 'suggest';
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
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowDelegationKeys.lists });
  const listQuery = useWorkflowDelegationList({ page, pageSize, scope: submittedParams.scope });
  const usersQuery = useWorkflowSelectableUsers();
  const definitionsQuery = useWorkflowDefinitionList({ page: 1, pageSize: 200 });
  const saveMutation = useSaveWorkflowDelegation();
  const deleteMutation = useDeleteWorkflowDelegations();

  const canManage = hasPermission('workflow:delegation:manage');

  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((u) => ({ label: u.nickname ?? u.username, value: u.id })),
    [usersQuery.data],
  );

  const defOptions = useMemo(
    () => (definitionsQuery.data?.list ?? []).map((d) => ({ value: d.id, label: d.name })),
    [definitionsQuery.data],
  );


  const delegationModal = useEditModal<WorkflowDelegation, FormValues, Record<string, unknown>>({
    entityName: '审批代理',
    save: saveMutation,
    defaults: { principalId: undefined, delegateId: undefined, definitionId: undefined, mode: 'full', startAt: null, endAt: null, reason: '', enabled: true },
    toValues: (row) => ({
      principalId: row.principalId, delegateId: row.delegateId, definitionId: row.definitionId ?? undefined,
      mode: row.mode ?? 'full',
      startAt: row.startAt ? new Date(row.startAt.replace(' ', 'T')) : null,
      endAt: row.endAt ? new Date(row.endAt.replace(' ', 'T')) : null,
      reason: row.reason ?? '', enabled: row.enabled,
    }),
    beforeSave: (vals) => ({
      ...(canManage && vals.principalId != null ? { principalId: Number(vals.principalId) } : {}),
      delegateId: Number(vals.delegateId),
      definitionId: vals.definitionId != null ? Number(vals.definitionId) : null,
      mode: vals.mode ?? 'full',
      startAt: vals.startAt ? formatDateTimeForApi(vals.startAt as Date) : null,
      endAt: vals.endAt ? formatDateTimeForApi(vals.endAt as Date) : null,
      reason: typeof vals.reason === 'string' && vals.reason.trim() ? vals.reason.trim() : null,
      enabled: vals.enabled ?? true,
    }),
  });

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
      minWidth: 180,
      render: (_v: unknown, r: WorkflowDelegation) =>
        r.definitionId == null ? '全部流程' : (r.definitionName ?? `#${r.definitionId}`),
    },
    {
      title: '代理模式',
      dataIndex: 'mode',
      width: 110,
      render: (v: WorkflowDelegation['mode']) => v === 'suggest'
        ? <Tag color="orange">建议制</Tag>
        : <Tag color="blue">直接代批</Tag>,
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
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '状态',
      dataIndex: 'active',
      width: 100,
      fixed: 'right',
      render: (_v: unknown, r: WorkflowDelegation) => renderDelegationStatus(r),
    },
    createOperationColumn<WorkflowDelegation>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canManage,
          onClick: () => delegationModal.openEdit(record),
        },
        deleteAction({
          hidden: !canManage,
          title: '确定删除该审批代理？',
          run: () => deleteMutation.mutateAsync([record.id]),
          successMessage: '已删除',
        }),
      ],
    }),
  ];

  const renderScopeFilter = () => (
    <Select
      value={draftParams.scope}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, scope: v as Scope }))}
      optionList={[
        { value: 'mine', label: '我的' },
        { value: 'all', label: '全部' },
      ]}
      style={{ width: 140 }}
    />
  );


  const renderCreateButton = () => canManage ? (
    <CreateButton onClick={delegationModal.openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={renderScopeFilter()}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        filterTitle="审批代理筛选"
      />

      <ConfigurableTable<WorkflowDelegation>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      {canManage && (
        <AppModal
          {...delegationModal.modalProps}
          closeOnEsc
          width={560}
        >
          <Form
            key={delegationModal.formKey} {...delegationModal.formProps}
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
            <Form.Select
              field="mode"
              label="代理模式"
              style={{ width: '100%' }}
              initValue="full"
              optionList={[
                { value: 'full', label: '直接代批（代理人审批即推进流程，留痕「代 xxx 审批」）' },
                { value: 'suggest', label: '建议制（代理人意见回执给委托人，由委托人最终确认）' },
              ]}
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
