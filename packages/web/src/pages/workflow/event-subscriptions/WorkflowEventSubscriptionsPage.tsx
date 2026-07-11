/**
 * 工作流事件订阅管理页面
 *
 * 提供事件订阅 CRUD + 启用/禁用 + 投递记录查看与重试。
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  SideSheet,
  Spin,
  Switch,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import type {
  WorkflowDefinition,
  WorkflowEventDelivery,
  WorkflowEventSubscription,
  WorkflowEventType,
} from '@zenith/shared';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useWorkflowDefinitionList } from '@/hooks/queries/workflow-definitions';
import {
  useDeleteWorkflowEventSubscription,
  useReplayWorkflowEventDeliveries,
  useRetryWorkflowEventDelivery,
  useSaveWorkflowEventSubscription,
  useToggleWorkflowEventSubscription,
  useWorkflowEventDeliveries,
  useWorkflowEventSubscriptionDetail,
  useWorkflowEventSubscriptionList,
  useWorkflowEventSubscriptionSecret,
  workflowEventSubscriptionKeys,
} from '@/hooks/queries/workflow-event-subscriptions';
import { useWorkflowConnectorList } from '@/hooks/queries/workflow-connectors';

const EVENT_OPTIONS: Array<{ value: WorkflowEventType; label: string }> = [
  { value: 'instance.created',   label: '实例创建' },
  { value: 'instance.approved',  label: '实例通过' },
  { value: 'instance.rejected',  label: '实例驳回' },
  { value: 'instance.withdrawn', label: '实例撤回' },
  { value: 'node.entered',       label: '节点进入' },
  { value: 'node.left',          label: '节点离开' },
  { value: 'task.created',       label: '任务创建' },
  { value: 'task.assigned',      label: '任务分配' },
  { value: 'task.approved',      label: '任务通过' },
  { value: 'task.rejected',      label: '任务驳回' },
  { value: 'task.skipped',       label: '任务跳过' },
  { value: 'task.transferred',   label: '任务转交' },
  { value: 'task.addSigned',     label: '任务加签' },
  { value: 'task.reduceSigned',  label: '任务减签' },
  { value: 'task.urged',         label: '任务催办' },
];
const EVENT_LABEL_MAP = Object.fromEntries(EVENT_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>;

const DELIVERY_STATUS_MAP: Record<string, { text: string; color: 'green' | 'red' | 'orange' | 'grey' }> = {
  pending: { text: '待发送', color: 'grey' },
  success: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  retrying: { text: '重试中', color: 'orange' },
};

interface FormValues {
  name: string;
  description?: string;
  definitionId?: number | null;
  events: WorkflowEventType[];
  url: string;
  secret?: string;
  signMode: 'hmacSha256' | 'none';
  headers?: string;
  connectorId?: number | null;
  enabled?: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export default function WorkflowEventSubscriptionsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const canManageEventSubscription = hasPermission('workflow:event-subscription:view');
  const { page, pageSize, setPage, buildPagination } = usePagination();
  interface SearchParams { keyword: string; definitionId: number | ''; enabled: '' | 'true' | 'false' }
  const defaultSearchParams: SearchParams = { keyword: '', definitionId: '', enabled: '' };
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const listQuery = useWorkflowEventSubscriptionList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    definitionId: submittedParams.definitionId === '' ? undefined : submittedParams.definitionId,
    enabled: submittedParams.enabled || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const definitionsQuery = useWorkflowDefinitionList({ page: 1, pageSize: 200 });
  const defs: WorkflowDefinition[] = definitionsQuery.data?.list ?? [];
  const connectorsQuery = useWorkflowConnectorList({ page: 1, pageSize: 100, status: 'enabled' });
  const connectorOptions = (connectorsQuery.data?.list ?? []).map((cn) => ({ value: cn.id, label: `${cn.name}（${cn.type}）` }));

  // 编辑弹窗
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowEventSubscription | null>(null);
  const detailQuery = useWorkflowEventSubscriptionDetail(editing?.id, modalVisible && !!editing);
  const saveMutation = useSaveWorkflowEventSubscription();
  const toggleMutation = useToggleWorkflowEventSubscription();
  const deleteMutation = useDeleteWorkflowEventSubscription();
  const secretMutation = useWorkflowEventSubscriptionSecret();

  // 投递抽屉
  const [deliveryVisible, setDeliveryVisible] = useState(false);
  const [deliverySubId, setDeliverySubId] = useState<number | null>(null);
  const { page: deliveryPage, pageSize: deliveryPageSize, setPage: setDeliveryPage, buildPagination: buildDeliveryPagination } = usePagination();
  const deliveriesQuery = useWorkflowEventDeliveries({
    page: deliveryPage,
    pageSize: deliveryPageSize,
    subscriptionId: deliverySubId,
  }, deliveryVisible);
  const deliveries = deliveriesQuery.data?.list ?? [];
  const deliveriesTotal = deliveriesQuery.data?.total ?? 0;
  const retryDeliveryMutation = useRetryWorkflowEventDelivery();
  const replayDeliveriesMutation = useReplayWorkflowEventDeliveries();

  useEffect(() => {
    if (!modalVisible || !detailQuery.data) return;
    setEditing(detailQuery.data);
    setTimeout(() => formApi.current?.setValues({
      name: detailQuery.data.name,
      description: detailQuery.data.description ?? '',
      definitionId: detailQuery.data.definitionId,
      events: detailQuery.data.events,
      url: detailQuery.data.url,
      secret: '',
      signMode: detailQuery.data.signMode,
      headers: detailQuery.data.headers ? JSON.stringify(detailQuery.data.headers, null, 2) : '',
      connectorId: detailQuery.data.connectorId,
      enabled: detailQuery.data.enabled,
    }), 0);
  }, [detailQuery.data, modalVisible]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowEventSubscriptionKeys.lists });
  };

  const openCreate = () => {
    setEditing(null);
    setModalVisible(true);
    setTimeout(() => formApi.current?.setValues({
      name: '', description: '', definitionId: null, events: [], url: '', secret: '',
      signMode: 'hmacSha256', headers: '', connectorId: null, enabled: true,
    }), 0);
  };

  const openEdit = (row: WorkflowEventSubscription) => {
    setEditing(row);
    setModalVisible(true);
    setTimeout(() => formApi.current?.setValues({
      name: row.name,
      description: row.description ?? '',
      definitionId: row.definitionId,
      events: row.events,
      url: row.url,
      secret: '',
      signMode: row.signMode,
      headers: row.headers ? JSON.stringify(row.headers, null, 2) : '',
      connectorId: row.connectorId,
      enabled: row.enabled,
    }), 0);
  };

  const handleSubmit = async (vals: FormValues) => {
    let headers: Record<string, string> | null = null;
    if (vals.headers?.trim()) {
      try {
        const parsed: unknown = JSON.parse(vals.headers);
        if (!isPlainRecord(parsed) || Object.entries(parsed).some(([key, value]) => !key.trim() || typeof value !== 'string')) {
          Toast.error('请输入合法的 JSON 对象');
          return;
        }
        headers = parsed as Record<string, string>;
      } catch { Toast.error('请输入合法的 JSON 对象'); return; }
    }
    const body = {
      name: vals.name,
      description: vals.description ?? null,
      definitionId: vals.definitionId ?? null,
      events: vals.events,
      url: vals.url,
      ...(vals.secret ? { secret: vals.secret } : {}),
      signMode: vals.signMode,
      headers,
      connectorId: vals.connectorId ?? null,
      enabled: vals.enabled ?? true,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: body });
    Toast.success(editing ? '已更新' : '已创建');
    setModalVisible(false);
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

  const handleToggle = async (row: WorkflowEventSubscription) => {
    await toggleMutation.mutateAsync({ id: row.id, enabled: !row.enabled });
    Toast.success('已切换');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const handleViewSecret = async (id: number) => {
    const secret = await secretMutation.mutateAsync(id);
    Modal.info({ title: '订阅 Secret', content: <Typography.Text copyable>{secret.secret}</Typography.Text> });
  };

  const openDeliveries = (row: WorkflowEventSubscription) => {
    setDeliverySubId(row.id); setDeliveryPage(1); setDeliveryVisible(true);
  };

  const handleRetryDelivery = async (id: number) => {
    await retryDeliveryMutation.mutateAsync(id);
    Toast.success('已加入重试');
  };

  // 4B 按筛选批量重放（订阅内：事件类型 + 状态 + 时间范围，含补发已成功）
  const [replayVisible, setReplayVisible] = useState(false);
  const [replayStatus, setReplayStatus] = useState<'all' | 'success' | 'failed' | 'pending'>('failed');
  const [replayEventType, setReplayEventType] = useState<WorkflowEventType | undefined>(undefined);
  const [replayRange, setReplayRange] = useState<Date[] | undefined>(undefined);

  const openReplay = () => {
    setReplayStatus('failed'); setReplayEventType(undefined); setReplayRange(undefined); setReplayVisible(true);
  };

  const handleReplay = async () => {
    if (deliverySubId === null) return;
    const start = replayRange?.[0];
    const end = replayRange?.[1];
    const body = { subscriptionId: deliverySubId };
    const result = await replayDeliveriesMutation.mutateAsync({
      ...body,
      ...(replayEventType ? { eventType: replayEventType } : {}),
      ...(replayStatus !== 'all' ? { status: replayStatus } : {}),
      ...(start ? { startAt: formatDateTimeForApi(start) } : {}),
      ...(end ? { endAt: formatDateTimeForApi(end) } : {}),
    });
    Toast.success(`已重放 ${result.count} 条投递`);
    setReplayVisible(false);
  };

  const columns: ColumnProps<WorkflowEventSubscription>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '名称', dataIndex: 'name', width: 180 },
    {
      title: '范围', dataIndex: 'definitionName', width: 160,
      render: (_v, r) => r.definitionId === null
        ? <Tag color="blue">全局</Tag>
        : <Typography.Text>{r.definitionName ?? `#${r.definitionId}`}</Typography.Text>,
    },
    {
      title: '订阅事件', dataIndex: 'events', width: 280,
      render: (v: WorkflowEventType[]) => (
        <Space wrap spacing={4}>
          {v.map((e) => <Tag key={e} size="small">{EVENT_LABEL_MAP[e] ?? e}</Tag>)}
        </Space>
      ),
    },
    { title: 'URL', dataIndex: 'url', width: 240, ellipsis: { showTitle: true } },
    { title: '签名', dataIndex: 'signMode', width: 100,
      render: (v: string) => v === 'hmacSha256' ? <Tag color="green" size="small">HMAC</Tag> : <Tag size="small">无</Tag>,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (v: string) => formatDateTime(v) },
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (v: boolean, r) => canManageEventSubscription
        ? <Switch checked={v} loading={toggleMutation.isPending && toggleMutation.variables?.id === r.id} onChange={() => handleToggle(r)} />
        : (v ? <Tag color="green">启用</Tag> : <Tag color="grey">禁用</Tag>),
    },
    createOperationColumn<WorkflowEventSubscription>({
      width: 280,
      desktopInlineKeys: ['edit', 'deliveries', 'secret', 'delete'],
      actions: (record) => [
        {
          key: 'edit',
          label: '编辑',
          hidden: !canManageEventSubscription,
          onClick: () => openEdit(record),
        },
        { key: 'deliveries', label: '投递', onClick: () => openDeliveries(record) },
        {
          key: 'secret',
          label: '密钥',
          hidden: !canManageEventSubscription,
          onClick: () => handleViewSecret(record.id),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canManageEventSubscription,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该订阅吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const deliveryColumns: ColumnProps<WorkflowEventDelivery>[] = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    {
      title: '事件', dataIndex: 'eventType', width: 140,
      render: (v: string) => EVENT_LABEL_MAP[v] ?? v,
    },
    { title: '次数', dataIndex: 'attempt', width: 70 },
    { title: 'HTTP', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? '-' },
    { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number | null) => v == null ? '-' : `${v}ms` },
    { title: '错误', dataIndex: 'errorMessage', width: 220, ellipsis: { showTitle: true } },
    { title: '时间', dataIndex: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: string) => {
        const m = DELIVERY_STATUS_MAP[v] ?? { text: v, color: 'grey' as const };
        return <Tag color={m.color}>{m.text}</Tag>;
      },
    },
    createOperationColumn<WorkflowEventDelivery>({
      width: 100,
      desktopInlineKeys: ['retry'],
      actions: (record) => [
        {
          key: 'retry',
          label: record.status === 'success' ? '重新投递' : '重试',
          hidden: !canManageEventSubscription || record.status === 'pending',
          onClick: () => handleRetryDelivery(record.id),
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="名称 / URL"
      value={draftParams.keyword}
      onChange={v => setDraftParams(prev => ({ ...prev, keyword: v }))}
      showClear
      style={{ width: 220 }}
      onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
    />
  );

  const renderDefinitionFilter = () => (
    <Select
      placeholder="所属流程"
      value={draftParams.definitionId === '' ? undefined : draftParams.definitionId}
      onChange={(v) => setDraftParams(prev => ({ ...prev, definitionId: (v as number) ?? '' }))}
      showClear
      style={{ width: 200 }}
      optionList={[{ value: '', label: '全部（含全局）' }, ...defs.map((d) => ({ value: d.id, label: d.name }))]}
    />
  );

  const renderEnabledFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.enabled || undefined}
      onChange={(v) => setDraftParams(prev => ({ ...prev, enabled: (v as 'true' | 'false') ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[
        { value: 'true', label: '启用' },
        { value: 'false', label: '禁用' },
      ]}
    />
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderCreateButton = () => canManageEventSubscription ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderDefinitionFilter()}
            {renderEnabledFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderDefinitionFilter()}
            {renderEnabledFilter()}
          </>
        )}
        filterTitle="订阅筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable<WorkflowEventSubscription>
        bordered
        loading={listQuery.isFetching}
        rowKey="id"
        dataSource={list}
        columns={columns}
        pagination={buildPagination(total)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <AppModal
        title={editing ? '编辑订阅' : '新增订阅'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); }}
        onOk={handleModalOk}
        confirmLoading={saveMutation.isPending}
        okButtonProps={{ disabled: detailQuery.isFetching }}
        closeOnEsc
        width={680}
      >
        <Spin spinning={detailQuery.isFetching} wrapperClassName="modal-spin-wrapper">
        <Form<FormValues> getFormApi={(api) => (formApi.current = api)} onSubmit={handleSubmit} allowEmpty labelPosition="left" labelWidth={110}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="名称" maxLength={64} rules={[{ required: true, message: '请输入名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="definitionId" label="所属流程" showClear
                style={{ width: '100%' }}
                helpText="不选则订阅全局"
                optionList={defs.map((d) => ({ value: d.id, label: d.name }))}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Select
                field="events" label="订阅事件" multiple maxTagCount={5}
                style={{ width: '100%' }}
                rules={[{ required: true, type: 'array', min: 1, message: '至少选择一个事件' }]}
                optionList={EVENT_OPTIONS}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Input field="url" label="回调 URL" placeholder="https://example.com/webhook"
                rules={[{ required: true, message: '请输入 URL' }, { pattern: /^https?:\/\//i, message: '必须以 http:// 或 https:// 开头' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input
                field="secret"
                label="签名密钥"
                placeholder={editing ? '留空保持不变' : '留空将自动生成'}
                maxLength={256}
              />
            </Col>
            <Col span={12}>
              <Form.Select field="signMode" label="签名模式" style={{ width: '100%' }} optionList={[
                { value: 'hmacSha256', label: 'HMAC-SHA256' },
                { value: 'none', label: '不签名' },
              ]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Switch field="enabled" label="启用" />
            </Col>
            <Col span={12}>
              <Form.Select
                field="connectorId" label="连接器" showClear
                style={{ width: '100%' }}
                helpText="经连接器投递（鉴权/超时/重试/熔断），URL 仍为完整地址"
                optionList={connectorOptions}
              />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea field="description" label="描述" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.TextArea
                field="headers"
                label="自定义请求头"
                autosize={{ minRows: 2, maxRows: 6 }}
                placeholder={'{\n  "X-Source": "zenith"\n}'}
                helpText="JSON 对象格式，可留空"
              />
            </Col>
          </Row>
        </Form>
        </Spin>
      </AppModal>

      <SideSheet
        title="投递记录"
        visible={deliveryVisible}
        onCancel={() => setDeliveryVisible(false)}
        width={1000}
      >
        {canManageEventSubscription && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <Button size="small" icon={<RotateCcw size={13} />} onClick={openReplay}>批量重放</Button>
          </div>
        )}
        <ConfigurableTable<WorkflowEventDelivery>
          bordered
          loading={deliveriesQuery.isFetching}
          rowKey="id"
          dataSource={deliveries}
          columns={deliveryColumns}
          pagination={{...buildDeliveryPagination(deliveriesTotal), showSizeChanger: false}}
          onRefresh={() => void deliveriesQuery.refetch()}
          refreshLoading={deliveriesQuery.isFetching}
        />
      </SideSheet>

      <AppModal
        title="按筛选批量重放投递"
        visible={replayVisible}
        onCancel={() => setReplayVisible(false)}
        onOk={() => void handleReplay()}
        confirmLoading={replayDeliveriesMutation.isPending}
        okText="重放"
        closeOnEsc
        width={460}
      >
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
          将当前订阅下匹配条件的投递重新入队投递（含补发已成功），单次上限 500 条。
        </Typography.Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 4 }}>状态</Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={replayStatus}
              onChange={(v) => setReplayStatus(v as 'all' | 'success' | 'failed' | 'pending')}
              optionList={[
                { value: 'failed', label: '失败 / 死信' },
                { value: 'success', label: '已成功（补发）' },
                { value: 'pending', label: '排队 / 进行中' },
                { value: 'all', label: '全部状态' },
              ]}
            />
          </div>
          <div>
            <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 4 }}>事件类型（可选）</Typography.Text>
            <Select
              style={{ width: '100%' }}
              placeholder="全部事件类型"
              showClear
              value={replayEventType}
              onChange={(v) => setReplayEventType(v as WorkflowEventType | undefined)}
              optionList={EVENT_OPTIONS}
            />
          </div>
          <div>
            <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 4 }}>时间范围（可选，按投递创建时间）</Typography.Text>
            <DatePicker
              type="dateTimeRange"
              style={{ width: '100%' }}
              value={replayRange}
              onChange={(v) => setReplayRange(Array.isArray(v) ? (v as Date[]) : undefined)}
            />
          </div>
        </div>
      </AppModal>
    </div>
  );
}
