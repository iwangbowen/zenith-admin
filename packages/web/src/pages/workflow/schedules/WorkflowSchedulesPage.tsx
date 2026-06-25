import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Form,
  Popconfirm,
  Select,
  Space,
  Tag,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type { PaginatedResponse, WorkflowDefinition, WorkflowSchedule } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';

type ScheduleStatus = WorkflowSchedule['status'];

interface UserOptionSource {
  id: number;
  nickname: string;
  username: string;
}

interface SearchParams {
  definitionId: number | '';
  status: ScheduleStatus | '';
}

interface FormValues extends Record<string, unknown> {
  definitionId?: number | null;
  name?: string;
  cronExpression?: string;
  initiatorId?: number | null;
  titleTemplate?: string | null;
  status?: ScheduleStatus;
}

const defaultSearchParams: SearchParams = { definitionId: '', status: '' };

const STATUS_OPTIONS: Array<{ value: ScheduleStatus; label: string }> = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

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
  const formApi = useRef<FormApi<FormValues> | null>(null);
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<WorkflowSchedule[]>([]);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [userOptions, setUserOptions] = useState<Array<{ label: string; value: number }>>([]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowSchedule | null>(null);
  const [saving, setSaving] = useState(false);
  const [cronExprValue, setCronExprValue] = useState('');
  const [runningId, setRunningId] = useState<number | null>(null);
  const canCreate = hasPermission('workflow:schedule:create');
  const canEdit = hasPermission('workflow:schedule:edit');
  const canDelete = hasPermission('workflow:schedule:delete');

  const definitionOptions = useMemo(
    () => definitions.map((item) => ({ value: item.id, label: item.name })),
    [definitions],
  );

  const fetchData = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const currentParams = params ?? searchParamsRef.current;
      setLoading(true);
      try {
        const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
        if (currentParams.definitionId !== '') {
          query.set('definitionId', String(currentParams.definitionId));
        }
        if (currentParams.status) {
          query.set('status', currentParams.status);
        }
        const res = await request.get<PaginatedResponse<WorkflowSchedule>>(
          `/api/workflows/schedules?${query.toString()}`,
        );
        if (res.code === 0) {
          setList(res.data.list);
          setTotal(res.data.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    request
      .get<WorkflowDefinition[]>('/api/workflows/definitions/published')
      .then((res) => {
        if (res.code === 0) setDefinitions(res.data);
      })
      .catch(() => {});

    request
      .get<UserOptionSource[]>('/api/users/all')
      .then((res) => {
        if (res.code === 0) {
          setUserOptions(
            res.data.map((user) => ({
              value: user.id,
              label: user.nickname || user.username,
            })),
          );
        }
      })
      .catch(() => {});
  }, []);

  const handleSearch = () => {
    setPage(1);
    void fetchData(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
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
      initiatorId: Number(values.initiatorId),
      titleTemplate:
        typeof values.titleTemplate === 'string' && values.titleTemplate.trim()
          ? values.titleTemplate.trim()
          : null,
      status: values.status ?? 'enabled',
    };

    setSaving(true);
    try {
      const res = editing
        ? await request.put<WorkflowSchedule>(`/api/workflows/schedules/${editing.id}`, body)
        : await request.post<WorkflowSchedule>('/api/workflows/schedules', body);
      if (res.code === 0) {
        Toast.success(editing ? '更新成功' : '创建成功');
        setModalVisible(false);
        setEditing(null);
        void fetchData();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/schedules/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      void fetchData();
    }
  };

  const handleRunOnce = async (row: WorkflowSchedule) => {
    setRunningId(row.id);
    try {
      const res = await request.post<WorkflowSchedule>(`/api/workflows/schedules/${row.id}/run`);
      if (res.code === 0) {
        Toast.success(res.message || '已触发');
        void fetchData();
      }
    } finally {
      setRunningId(null);
    }
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
      render: (value: string) => (
        <code style={{ fontFamily: 'var(--semi-font-family-monospace), monospace' }}>{value}</code>
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
    {
      title: '操作',
      dataIndex: 'op',
      width: 190,
      fixed: 'right',
      render: (_value: unknown, record) => (
        <Space>
          {canEdit && (
            <Button theme="borderless" size="small" onClick={() => openEdit(record)}>
              编辑
            </Button>
          )}
          {canEdit && (
            <Button
              theme="borderless"
              size="small"
              loading={runningId === record.id}
              disabled={runningId !== null}
              onClick={() => handleRunOnce(record)}
            >
              立即执行
            </Button>
          )}
          {canDelete && (
            <Popconfirm title="确定要删除该定时发起规则吗？" onConfirm={() => handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const renderDefinitionFilter = () => (
    <Select
      placeholder="流程"
      value={searchParams.definitionId === '' ? undefined : searchParams.definitionId}
      onChange={(value) =>
        setSearchParams((prev) => ({ ...prev, definitionId: (value as number) ?? '' }))
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
      value={searchParams.status || undefined}
      onChange={(value) =>
        setSearchParams((prev) => ({ ...prev, status: (value as ScheduleStatus) ?? '' }))
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
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="id"
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total, fetchData)}
      />

      <AppModal
        title={editing ? '编辑定时发起规则' : '新建定时发起规则'}
        visible={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditing(null);
        }}
        onOk={() => formApi.current?.submitForm()}
        confirmLoading={saving}
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
            extraText="标准 5 段 cron，时区 Asia/Shanghai，例：0 9 * * 1 表示每周一 9:00"
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
