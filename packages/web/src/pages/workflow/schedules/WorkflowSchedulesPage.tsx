import { useMemo, useState } from 'react';
import { Form, Space, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { WorkflowSchedule } from '@zenith/shared/workflow';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import ConfigurableTable from '@/components/ConfigurableTable';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { usePublishedWorkflowDefinitions, useWorkflowDefinitionDetail } from '@/hooks/queries/workflow-definitions';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useDeleteWorkflowSchedules,
  useRunWorkflowSchedule,
  useSaveWorkflowSchedule,
  useWorkflowScheduleList,
  workflowScheduleKeys,
} from '@/hooks/queries/workflow-schedules';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { dateTimeColumn } from '@/utils/table-columns';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';
import { FilterSelect, StatusSelect } from '@/components/search-filters';

type ScheduleStatus = WorkflowSchedule['status'];

interface SearchParams {
  definitionId?: number;
  status?: ScheduleStatus;
}

interface FormValues extends Record<string, unknown> {
  definitionId?: number | null;
  name?: string;
  cronExpression?: string;
  timezone?: string | null;
  initiatorId?: number | null;
  titleTemplate?: string | null;
  formDataJson?: string;
  status?: ScheduleStatus;
}

const defaultSearchParams: SearchParams = { definitionId: undefined, status: undefined };

// CronBuilderPopover 内部使用 6 段（含秒）cron；定时发起存标准 5 段，故在边界转换
const toSixField = (expr: string) => {
  const e = (expr ?? '').trim();
  return e.split(/\s+/).length === 5 ? `0 ${e}` : e;
};
const toFiveField = (expr: string) => {
  const e = (expr ?? '').trim();
  const parts = e.split(/\s+/);
  return parts.length === 6 ? parts.slice(1).join(' ') : e;
};

function renderStatus(status: ScheduleStatus) {
  return status === 'enabled' ? <Tag color="green">启用</Tag> : <Tag color="grey">禁用</Tag>;
}

function renderLastRunStatus(status: string | null, message: string | null) {
  if (!status) return null;
  const color = status === 'success' ? 'green' : status === 'fail' ? 'red' : 'grey';
  const label = status === 'success' ? '成功' : status === 'fail' ? '失败' : status;
  const tag = (
    <Tag color={color} size="small">
      {label}
    </Tag>
  );
  return message ? <Tooltip content={message}>{tag}</Tooltip> : tag;
}

export default function WorkflowSchedulesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: workflowScheduleKeys.lists });
  const listQuery = useWorkflowScheduleList({
    page,
    pageSize,
    definitionId: submittedParams.definitionId,
    status: submittedParams.status || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const definitionsQuery = usePublishedWorkflowDefinitions();
  const usersQuery = useAllUsers();

  const [cronExprValue, setCronExprValue] = useState('');
  // 弹窗内当前选中的流程：用于拉取定义详情，提示可预填的表单字段
  const [modalDefinitionId, setModalDefinitionId] = useState<number | null>(null);
  const definitionDetailQuery = useWorkflowDefinitionDetail(modalDefinitionId);
  const saveMutation = useSaveWorkflowSchedule();
  const deleteMutation = useDeleteWorkflowSchedules();
  const runMutation = useRunWorkflowSchedule();
  const canCreate = hasPermission('workflow:schedule:create');
  const canEdit = hasPermission('workflow:schedule:edit');
  const canDelete = hasPermission('workflow:schedule:delete');

  const definitionOptions = useMemo(
    () => (definitionsQuery.data ?? []).map((item) => ({ value: item.id, label: item.name })),
    [definitionsQuery.data],
  );
  const userOptions = useMemo(
    () => (usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username })),
    [usersQuery.data],
  );

  const scheduleModal = useEditModal<WorkflowSchedule, FormValues, Record<string, unknown>>({
    save: saveMutation,
    defaults: { definitionId: null, name: '', cronExpression: '', timezone: null, initiatorId: null, titleTemplate: '', formDataJson: '', status: 'enabled' },
    toValues: (row) => ({
      definitionId: row.definitionId,
      name: row.name,
      cronExpression: row.cronExpression,
      timezone: row.timezone ?? null,
      initiatorId: row.initiatorId,
      titleTemplate: row.titleTemplate ?? '',
      formDataJson: row.formData && Object.keys(row.formData).length ? JSON.stringify(row.formData, null, 2) : '',
      status: row.status,
    }),
    beforeSave: (values) => {
      let formData: Record<string, unknown> | null = null;
      const json = typeof values.formDataJson === 'string' ? values.formDataJson.trim() : '';
      if (json) {
        try {
          const parsed: unknown = JSON.parse(json);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            Toast.error('表单数据必须是 JSON 对象'); abortSubmit('validation');
          }
          formData = parsed as Record<string, unknown>;
        } catch {
          Toast.error('表单数据不是合法的 JSON'); abortSubmit('validation');
        }
      }
      return {
        definitionId: Number(values.definitionId),
        name: String(values.name ?? '').trim(),
        cronExpression: String(values.cronExpression ?? '').trim(),
        timezone: typeof values.timezone === 'string' && values.timezone.trim() ? values.timezone.trim() : null,
        initiatorId: Number(values.initiatorId),
        titleTemplate:
          typeof values.titleTemplate === 'string' && values.titleTemplate.trim()
            ? values.titleTemplate.trim()
            : null,
        formData,
        status: values.status ?? 'enabled',
      };
    },
    successMessage: ({ isEdit }) => (isEdit ? '更新成功' : '创建成功'),
    labelWidth: 110,
  });
  const editing = scheduleModal.editing;

  const openCreate = () => { setCronExprValue(''); setModalDefinitionId(null); scheduleModal.openCreate(); };
  const openEdit = (row: WorkflowSchedule) => { setCronExprValue(row.cronExpression ?? ''); setModalDefinitionId(row.definitionId); scheduleModal.openEdit(row); };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('已删除');
  };

  const handleRunOnce = async (row: WorkflowSchedule) => {
    await runMutation.mutateAsync({ params: { id: row.id } });
    Toast.success('已触发');
  };

  const columns: ColumnProps<WorkflowSchedule>[] = [
    {
      title: '规则名称',
      dataIndex: 'name',
      minWidth: 180,
    },
    {
      title: '流程',
      dataIndex: 'definitionName',
      width: 180,
      render: (_value: unknown, record) => record.definitionName ?? `#${record.definitionId}`,
    },
    {
      title: '发起人',
      dataIndex: 'initiatorName',
      width: 140,
      render: (_value: unknown, record) => record.initiatorName ?? `#${record.initiatorId}`,
    },
    {
      title: 'Cron 表达式',
      dataIndex: 'cronExpression',
      width: 180,
      render: (value: string, record) => (
        <Space spacing={6}>
          <code style={{ fontFamily: 'var(--semi-font-family-monospace), monospace' }}>{value}</code>
          {record.timezone && record.timezone !== DEFAULT_TIMEZONE ? <Tag size="small" color="blue">{record.timezone}</Tag> : null}
        </Space>
      ),
    },
    dateTimeColumn('下次执行', 'nextRunAt'),
    {
      title: '最近执行',
      dataIndex: 'lastRunAt',
      width: 220,
      render: (_value: string | null, record) => (
        <Space spacing={6}>
          <span>{record.lastRunAt ? formatDateTime(record.lastRunAt) : '—'}</span>
          {renderLastRunStatus(record.lastRunStatus, record.lastRunMessage)}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: ScheduleStatus) => renderStatus(value),
    },
    createOperationColumn<WorkflowSchedule>({
      width: 240,
      desktopInlineKeys: ['edit', 'run-once', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canEdit,
          onClick: () => openEdit(record),
        },
        {
          key: 'run-once',
          label: '立即执行',
          hidden: !canEdit,
          loading: runMutation.isPending && runMutation.variables?.params.id === record.id,
          disabled: runMutation.isPending,
          onClick: () => handleRunOnce(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该定时发起规则吗？',
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderDefinitionFilter = () => (
    <FilterSelect
      placeholder="全部流程"
      items={definitionOptions}
      value={draftParams.definitionId}
      onChange={(value) =>
        setDraftParams((prev) => ({ ...prev, definitionId: value as number | undefined }))}
      width={220}
      filter
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={STATUS_OPTIONS}
      value={draftParams.status}
      onChange={(value) =>
        setDraftParams((prev) => ({ ...prev, status: value as ScheduleStatus | undefined }))}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderCreateButton = () => canCreate ? (
    <CreateButton onClick={openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderDefinitionFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderDefinitionFilter()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={renderStatusFilter()}
        filterTitle="定时规则筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable<WorkflowSchedule>
        bordered
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total)}
      />

      <AppModal
        {...scheduleModal.modalProps}
        title={editing ? '编辑定时发起规则' : '新建定时发起规则'}
        okText={editing ? '保存' : '创建'}
        closeOnEsc
        width={620}
      >
        <Form
          key={scheduleModal.formKey} {...scheduleModal.formProps}
          onValueChange={(v) => {
            if (typeof v.cronExpression === 'string') setCronExprValue(v.cronExpression);
            const defId = typeof v.definitionId === 'number' ? v.definitionId : null;
            setModalDefinitionId((prev) => (prev === defId ? prev : defId));
          }}
        >
          <Form.Select
            field="definitionId"
            label="流程"
            style={{ width: '100%' }}
            optionList={definitionOptions}
            filter
            rules={[{ required: true, message: '请选择流程' }]}
          />
          <Form.Input
            field="name"
            label="规则名称"
            maxLength={64}
            rules={[{ required: true, message: '请输入规则名称' }]}
          />
          <Form.Input
            field="cronExpression"
            label="Cron 表达式"
            maxLength={64}
            rules={[{ required: true, message: '请输入 Cron 表达式' }]}
            extraText="标准 5 段 cron，按下方时区解释，例：0 9 * * 1 表示每周一 9:00"
            addonAfter={
              <CronBuilderPopover
                value={toSixField(cronExprValue)}
                onApply={(expr) => {
                  const five = toFiveField(expr);
                  scheduleModal.formApi.current?.setValue('cronExpression', five);
                  setCronExprValue(five);
                }}
              />
            }
          />
          <FormTimezoneSelect
            required={false}
            extraText={`Cron 按该 IANA 时区计算触发时间；留空使用 ${DEFAULT_TIMEZONE}`}
          />
          <Form.Select
            field="initiatorId"
            label="发起人"
            style={{ width: '100%' }}
            optionList={userOptions}
            filter
            rules={[{ required: true, message: '请选择发起人' }]}
          />
          <Form.Input
            field="titleTemplate"
            label="标题模板"
            maxLength={255}
            extraText="支持 {{date}} {{datetime}} 占位，留空用规则名"
          />
          <Form.TextArea
            field="formDataJson"
            label="表单数据"
            autosize={{ minRows: 3, maxRows: 10 }}
            placeholder={'JSON 对象，作为发起实例的表单数据\n例：{\n  "leave_type": "年假",\n  "leave_days": 1\n}'}
            extraText={(() => {
              const def = definitionDetailQuery.data;
              if (!def) return '发起时作为实例表单数据；含必填字段或条件分支的流程建议预填，否则实例将以空表单发起';
              const fields = def.formType === 'designer'
                ? (def.formFields ?? []).map((f) => `${f.key}（${f.label}${f.required ? '，必填' : ''}）`)
                : (def.customForm?.variables ?? []).map((v) => `${v.key}（${v.label}）`);
              return fields.length
                ? (
                  <Typography.Text type="tertiary" size="small">
                    可用字段：{fields.join('、')}
                  </Typography.Text>
                )
                : '该流程未声明表单字段';
            })()}
          />
          <Form.Select
            field="status"
            label="状态"
            style={{ width: '100%' }}
            optionList={STATUS_OPTIONS}
            rules={[{ required: true, message: '请选择状态' }]}
            initValue="enabled"
          />
        </Form>
      </AppModal>
    </div>
  );
}
