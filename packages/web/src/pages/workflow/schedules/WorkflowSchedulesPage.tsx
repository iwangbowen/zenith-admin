import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Modal,
  Select,
  Space,
  Tag,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { WorkflowSchedule } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { usePublishedWorkflowDefinitions } from '@/hooks/queries/workflow-definitions';
import { useAllUsers } from '@/hooks/queries/users';
import {
  useDeleteWorkflowSchedule,
  useRunWorkflowSchedule,
  useSaveWorkflowSchedule,
  useWorkflowScheduleList,
  workflowScheduleKeys,
} from '@/hooks/queries/workflow-schedules';
import { useDictItems } from '@/hooks/useDictItems';

type ScheduleStatus = WorkflowSchedule['status'];

interface SearchParams {
  definitionId: number | '';
  status: ScheduleStatus | '';
}

interface FormValues extends Record<string, unknown> {
  definitionId?: number | null;
  name?: string;
  cronExpression?: string;
  timezone?: string | null;
  initiatorId?: number | null;
  titleTemplate?: string | null;
  status?: ScheduleStatus;
}

const defaultSearchParams: SearchParams = { definitionId: '', status: '' };

/** 常用 IANA 时区选项（默认 Asia/Shanghai，可输入过滤） */
const TIMEZONE_OPTIONS = [
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Seoul',
  'Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
].map((tz) => ({ value: tz, label: tz }));

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
  return status === 'enabled' ? <Tag color="green">启用</Tag> : <Tag color="grey">停用</Tag>;
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
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi<FormValues> | null>(null);
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useWorkflowScheduleList({
    page,
    pageSize,
    definitionId: submittedParams.definitionId === '' ? undefined : submittedParams.definitionId,
    status: submittedParams.status || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const definitionsQuery = usePublishedWorkflowDefinitions();
  const usersQuery = useAllUsers();

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowSchedule | null>(null);
  const [cronExprValue, setCronExprValue] = useState('');
  const saveMutation = useSaveWorkflowSchedule();
  const deleteMutation = useDeleteWorkflowSchedule();
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

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowScheduleKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowScheduleKeys.lists });
  };

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
    setCronExprValue('');
    setTimeout(() => {
      formApi.current?.setValues({
        definitionId: null,
        name: '',
        cronExpression: '',
        timezone: null,
        initiatorId: null,
        titleTemplate: '',
        status: 'enabled',
      });
    }, 0);
  };

  const openEdit = (row: WorkflowSchedule) => {
    setEditing(row);
    setModalVisible(true);
    setCronExprValue(row.cronExpression ?? '');
    setTimeout(() => {
      formApi.current?.setValues({
        definitionId: row.definitionId,
        name: row.name,
        cronExpression: row.cronExpression,
        timezone: row.timezone ?? null,
        initiatorId: row.initiatorId,
        titleTemplate: row.titleTemplate ?? '',
        status: row.status,
      });
    }, 0);
  };

  const handleSubmit = async (values: FormValues) => {
    const body = {
      definitionId: Number(values.definitionId),
      name: String(values.name ?? '').trim(),
      cronExpression: String(values.cronExpression ?? '').trim(),
      timezone: typeof values.timezone === 'string' && values.timezone.trim() ? values.timezone.trim() : null,
      initiatorId: Number(values.initiatorId),
      titleTemplate:
        typeof values.titleTemplate === 'string' && values.titleTemplate.trim()
          ? values.titleTemplate.trim()
          : null,
      status: values.status ?? 'enabled',
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

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const handleRunOnce = async (row: WorkflowSchedule) => {
    await runMutation.mutateAsync(row.id);
    Toast.success('已触发');
  };

  const columns: ColumnProps<WorkflowSchedule>[] = [
    {
      title: '规则名称',
      dataIndex: 'name',
      width: 180,
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
          {record.timezone && record.timezone !== 'Asia/Shanghai' ? <Tag size="small" color="blue">{record.timezone}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '下次执行',
      dataIndex: 'nextRunAt',
      width: 170,
      render: (value: string | null) => (value ? formatDateTime(value) : '—'),
    },
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
      width: 190,
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
          loading: runMutation.isPending && runMutation.variables === record.id,
          disabled: runMutation.isPending,
          onClick: () => handleRunOnce(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该定时发起规则吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderDefinitionFilter = () => (
    <Select
      placeholder="流程"
      value={draftParams.definitionId === '' ? undefined : draftParams.definitionId}
      onChange={(value) =>
        setDraftParams((prev) => ({ ...prev, definitionId: (value as number) ?? '' }))
      }
      optionList={definitionOptions}
      filter
      showClear
      style={{ width: 220 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.status || undefined}
      onChange={(value) =>
        setDraftParams((prev) => ({ ...prev, status: (value as ScheduleStatus) ?? '' }))
      }
      optionList={STATUS_OPTIONS}
      showClear
      style={{ width: 120 }}
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

  const renderCreateButton = () => canCreate ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>
      新增
    </Button>
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
        title={editing ? '编辑定时发起规则' : '新建定时发起规则'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        onOk={handleModalOk}
        confirmLoading={saveMutation.isPending}
        okText={editing ? '保存' : '创建'}
        closeOnEsc
        width={620}
      >
        <Form<FormValues>
          getFormApi={(api) => {
            formApi.current = api;
          }}
          onSubmit={handleSubmit}
          onValueChange={(v) => { if (typeof v.cronExpression === 'string') setCronExprValue(v.cronExpression); }}
          labelPosition="left"
          labelWidth={110}
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
                  formApi.current?.setValue('cronExpression', five);
                  setCronExprValue(five);
                }}
              />
            }
          />
          <Form.Select
            field="timezone"
            label="时区"
            style={{ width: '100%' }}
            optionList={TIMEZONE_OPTIONS}
            filter
            showClear
            placeholder="默认 Asia/Shanghai"
            extraText="Cron 按该 IANA 时区计算触发时间，留空使用 Asia/Shanghai"
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
