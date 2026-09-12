import { useState } from 'react';
import { SearchToolbar } from '@/components/SearchToolbar';
import { deleteAction, ListSearchToolbar, listTableProps, useRowSelection } from '@/components/list-page';
import { Button, Tag, TagGroup, Modal, Form, Toast, Typography, Banner, SideSheet, Descriptions } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { USER_STATUSES, enumValueOf } from '@zenith/shared/core';
import { OPEN_WEBHOOK_DELIVERY_STATUS_LABELS, OPEN_WEBHOOK_EVENTS, OPEN_WEBHOOK_EVENT_LABELS, PAYMENT_WEBHOOK_EVENTS, OPEN_WEBHOOK_DELIVERY_STATUS_OPTIONS } from '@zenith/shared/open-platform';
import type { AppWebhookSubscription, AppWebhookDelivery, OpenWebhookEvent, OpenWebhookSignMode } from '@zenith/shared/open-platform';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import {
  useBatchRetryWebhookDeliveries,
  useDeleteWebhook,
  useOpenAppOptions,
  useRegenerateWebhookSecret,
  useRetryWebhookDelivery,
  useSaveWebhook,
  useTestWebhook,
  useWebhookDeliveries,
  useWebhookEvents,
  useWebhookList,
  webhookKeys,
  type SaveWebhookValues,
  type WebhookApiScope,
} from '@/hooks/queries/open-platform';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { abortSubmit } from '@/lib/abort-submit';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';

const { Text, Paragraph } = Typography;

const SIGN_MODE_OPTIONS = [
  { value: 'hmacSha256', label: 'HMAC-SHA256（推荐）' },
  { value: 'none', label: '不签名（仅非支付事件）' },
];

const SENSITIVE_EVENTS = new Set<string>(PAYMENT_WEBHOOK_EVENTS);

const DELIVERY_STATUS_COLOR: Record<string, 'blue' | 'green' | 'red' | 'orange'> = { pending: 'blue', success: 'green', failed: 'red', retrying: 'orange' };

type FormValues = {
  clientId: string;
  name: string;
  url: string;
  events: OpenWebhookEvent[];
  signMode: OpenWebhookSignMode;
  headersText?: string;
  status: 'enabled' | 'disabled';
};

export interface WebhooksPageProps {
  scope?: WebhookApiScope;
}

export default function WebhooksPage({ scope = 'open' }: Readonly<WebhooksPageProps>) {
  const paymentScope = scope === 'payment';
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canManage = hasPermission(paymentScope ? 'payment:webhook:manage' : 'open:webhook:manage');

  interface SearchParams { keyword: string; clientId?: string; status?: string }
  const defaultSearchParams: SearchParams = { keyword: '', clientId: undefined, status: undefined };
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: webhookKeys(scope).lists,
  });

  const appOptionsQuery = useOpenAppOptions();
  const eventOptionsQuery = useWebhookEvents(scope);
  const appOptions = appOptionsQuery.data ?? [];
  const eventOptions = eventOptionsQuery.data ?? [];

  const [secretModal, setSecretModal] = useState(false);
  const [oneTimeSecret, setOneTimeSecret] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);

  // 投递日志抽屉
  const [drawerSub, setDrawerSub] = useState<AppWebhookSubscription | null>(null);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [deliveryStatus, setDeliveryStatus] = useState<AppWebhookDelivery['status'] | undefined>();
  const [deliveryEventType, setDeliveryEventType] = useState<string | undefined>();
  const { selectedRowKeys: selectedDeliveryIds, clear: clearDeliverySelection, rowSelection: deliveryRowSelection } = useRowSelection<number, AppWebhookDelivery>({
    extra: { getCheckboxProps: (record: AppWebhookDelivery) => ({ disabled: record.status !== 'failed' }) },
  });

  const listQuery = useWebhookList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    clientId: submittedParams.clientId,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }, scope);
  const deliveryQuery = useWebhookDeliveries({
    subscriptionId: drawerSub?.id,
    page: deliveryPage,
    pageSize: 10,
    status: deliveryStatus,
    eventType: deliveryEventType,
  }, !!drawerSub, scope);
  const deliveries = deliveryQuery.data ?? null;
  const saveMutation = useSaveWebhook(scope);
  const deleteMutation = useDeleteWebhook(scope);
  const regenerateMutation = useRegenerateWebhookSecret(scope);
  const testMutation = useTestWebhook(scope);
  const retryMutation = useRetryWebhookDelivery(scope);
  const batchRetryMutation = useBatchRetryWebhookDeliveries(scope);
  const modal = useEditModal<AppWebhookSubscription, FormValues, SaveWebhookValues>({
    save: saveMutation,
    defaults: { events: [], signMode: 'hmacSha256', status: 'enabled' },
    // 记录里的 null 所属应用（系统内部订阅）在表单中视为未选；事件按事件目录收窄
    toValues: (record) => ({
      clientId: record.clientId ?? '',
      name: record.name,
      url: record.url,
      events: record.events.flatMap((event) => enumValueOf(OPEN_WEBHOOK_EVENTS, event) ?? []),
      signMode: record.signMode,
      headersText: record.headers ? JSON.stringify(record.headers, null, 2) : '',
      status: record.status,
    }),
    beforeSave: (values, { isEdit, editing }) => {
      let headers: Record<string, string> | undefined;
      if (values.headersText && values.headersText.trim()) {
        try {
          const parsed = JSON.parse(values.headersText) as unknown;
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object'
            || Object.values(parsed).some((value) => typeof value !== 'string')) {
            throw new Error('invalid headers');
          }
          headers = parsed as Record<string, string>;
        } catch {
          Toast.error('自定义请求头必须是值均为字符串的 JSON 对象');
          abortSubmit();
        }
      }
      const reservedHeader = Object.keys(headers ?? {}).find((key) => {
        const normalized = key.trim().toLowerCase();
        return normalized === 'content-type' || normalized.startsWith('x-zenith-');
      });
      if (reservedHeader) {
        Toast.error(`自定义请求头不能覆盖保留头：${reservedHeader}`);
        abortSubmit();
      }
      if (paymentScope && values.events.length === 0) {
        Toast.error('请至少选择一个支付或退款事件');
        abortSubmit();
      }
      const hasSensitiveEvent = values.events.some((event) => SENSITIVE_EVENTS.has(event));
      if (hasSensitiveEvent && values.signMode !== 'hmacSha256') {
        Toast.error('支付与退款事件必须使用 HMAC-SHA256 签名');
        abortSubmit();
      }
      if (isEdit && values.signMode === 'hmacSha256' && !editing?.hasSecret) {
        Toast.error('请先关闭弹窗并使用“重置密钥”生成 HMAC 密钥');
        abortSubmit();
      }
      const payload = { clientId: values.clientId, name: values.name, url: values.url, events: values.events, signMode: values.signMode, headers, status: values.status };
      if (!isEdit) return payload;
      const { clientId: _clientId, ...rest } = payload;
      return rest;
    },
    onSaved: (created, { isEdit }) => {
      if (isEdit) return;
      const secret = 'secret' in created && typeof created.secret === 'string' ? created.secret : '';
      if (secret) { setOneTimeSecret(secret); setSecretModal(true); }
    },
    labelWidth: 100,
  });

  function openCreate() {
    setFormEvents([]);
    modal.openCreate();
  }

  function openEdit(record: AppWebhookSubscription) {
    setFormEvents(record.events);
    modal.openEdit(record);
  }

  async function handleRegenerate(id: number) {
    const res = await regenerateMutation.mutateAsync({ params: { id } });
    if (res.secret) { setOneTimeSecret(res.secret); setSecretModal(true); }
  }
  async function handleTest(id: number) {
    await testMutation.mutateAsync({ params: { id } });
    Toast.success('已发送测试投递，请在投递日志中查看结果');
  }

  // ─── 投递日志 ──────────────────────────────────────────────────────────────
  function openDeliveries(sub: AppWebhookSubscription) {
    setDrawerSub(sub);
    setDeliveryPage(1);
    setDeliveryStatus(undefined);
    setDeliveryEventType(undefined);
    clearDeliverySelection();
  }
  async function retryDelivery(id: number) {
    await retryMutation.mutateAsync({ params: { id } });
    Toast.success('已触发重试');
  }
  async function batchRetryDeliveries() {
    const result = await batchRetryMutation.mutateAsync({ body: { ids: selectedDeliveryIds } });
    clearDeliverySelection();
    Toast.success(`已将 ${result.scheduled} 条投递加入重试队列`);
  }

  const columns: ColumnProps<AppWebhookSubscription>[] = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', width: 200, render: renderEllipsis },
    { title: '所属应用', dataIndex: 'clientId', width: 200, render: (v: string | null) => <Text size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 190 }}>{v ? (appOptions.find((a) => a.clientId === v)?.name ?? v) : '系统内部'}</Text> },
    { title: '回调地址', dataIndex: 'url', minWidth: 240, render: (v: string) => <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 230 }}>{v}</Text> },
    {
      title: '订阅事件',
      dataIndex: 'events',
      width: 200,
      render: (v: string[]) => v.length === 0
        ? <Tag size="small" color="grey">{paymentScope ? '未配置' : '全部非支付事件'}</Tag>
        : (
          <TagGroup
            maxTagCount={2}
            showPopover
            size="small"
            tagList={v.map((e) => ({ tagKey: e, children: OPEN_WEBHOOK_EVENT_LABELS[e] ?? e, color: 'blue' as const, size: 'small' as const }))}
          />
        ),
    },
    { title: '签名', dataIndex: 'signMode', width: 90, render: (v: string) => v === 'hmacSha256' ? <Tag size="small" color="orange">HMAC</Tag> : <Text type="tertiary">无</Text> },
    dateTimeColumn('最近投递', 'lastDeliveryAt'),
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: renderEnabledStatusTag,
    },
    createOperationColumn<AppWebhookSubscription>({
      width: 210,
      desktopInlineKeys: ['deliveries', 'edit'],
      actions: (record) => [
        { key: 'deliveries', label: '投递日志', onClick: () => openDeliveries(record) },
        { key: 'edit', label: '编辑', hidden: !canManage, onClick: () => openEdit(record) },
        { key: 'test', label: '测试', hidden: !canManage, onClick: () => void handleTest(record.id) },
        {
          key: 'regenerate', label: '重置密钥', hidden: !canManage,
          onClick: () => {
            confirmDanger({ title: '重置签名密钥？旧密钥将立即失效', onOk: () => handleRegenerate(record.id) });
          },
        },
        deleteAction({
          hidden: !canManage,
          title: '确定删除此 Webhook 订阅？',
          content: '关联投递日志将一并删除',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
        }),
      ],
    }),
  ];

  const deliveryColumns: ColumnProps<AppWebhookDelivery>[] = [
    dateTimeColumn('时间', 'createdAt'),
    { title: '事件', dataIndex: 'eventType', minWidth: 130, render: (v: string) => OPEN_WEBHOOK_EVENT_LABELS[v] ?? v },
    { title: '尝试', dataIndex: 'attempt', width: 60 },
    { title: '响应码', dataIndex: 'responseStatus', width: 80, render: (v: number | null) => v ?? EMPTY_PLACEHOLDER },
    { title: '耗时', dataIndex: 'durationMs', width: 80, align: 'right', render: (v: number | null) => v != null ? `${v}ms` : EMPTY_PLACEHOLDER },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right' as const,
      render: (v: string) => <Tag size="small" color={DELIVERY_STATUS_COLOR[v] ?? 'grey'}>{OPEN_WEBHOOK_DELIVERY_STATUS_LABELS[v as keyof typeof OPEN_WEBHOOK_DELIVERY_STATUS_LABELS] ?? v}</Tag>,
    },
    createOperationColumn<AppWebhookDelivery>({
      width: 100,
      actions: (record) => [
        { key: 'retry', label: '重试', hidden: !canManage || record.status !== 'failed', onClick: () => void retryDelivery(record.id) },
      ],
    }),
  ];

  /** 行内展开：补充行上没有的事件 ID / 重试计划 / 错误与响应 */
  const renderDeliveryExpanded = (record?: AppWebhookDelivery) => (record ? (
    <Descriptions
      align="plain"
      layout="horizontal"
      column={2}
      style={{ width: '100%', padding: '4px 0' }}
      data={[
        { key: '事件 ID', value: record.eventId },
        { key: '下次重试', value: record.nextRetryAt ?? EMPTY_PLACEHOLDER },
        { key: '错误信息', value: record.errorMessage ?? EMPTY_PLACEHOLDER, span: 2 },
        { key: '响应内容', span: 2, value: <Paragraph style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{record.responseBody || EMPTY_PLACEHOLDER}</Paragraph> },
      ]}
    />
  ) : null);

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(<KeywordInput placeholder="搜索名称 / URL" {...bindKeyword('keyword')} width={200} />)}
        filters={(
          <>
            <FilterSelect
              placeholder="全部所属应用"
              items={appOptions.map((a) => ({ value: a.clientId, label: a.name }))}
              {...bind('clientId')}
              width={180}
              filter
            />
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage && <CreateButton onClick={openCreate} />}
        mobileActions={(<ResetButton onClick={handleReset} />)}
        actionTitle="Webhook 操作"
      />

      <ConfigurableTable

        columns={columns}






        empty={paymentScope ? '暂无支付 Webhook 订阅' : '暂无 Webhook 订阅'}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      {/* 新增 / 编辑 */}
      <AppModal
        {...modal.modalProps}
        title={modal.isEdit ? '编辑 Webhook 订阅' : '新增 Webhook 订阅'}
        width={600}
      >
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Select field="clientId" label="所属应用" disabled={modal.isEdit} style={{ width: '100%' }} filter optionList={appOptions.map((a) => ({ value: a.clientId, label: a.name }))} rules={[{ required: true, message: '请选择所属应用' }]} />
          <Form.Input field="name" label="名称" placeholder="如 订单回调" rules={[{ required: true, message: '名称不能为空' }]} />
          <Form.Input field="url" label="回调地址" placeholder="https://your-app.com/webhook" rules={[{ required: true, message: '请输入回调地址' }]} />
          <Form.Select
            field="events"
            label="订阅事件"
            multiple
            style={{ width: '100%' }}
            placeholder={paymentScope ? '请选择支付或退款事件' : '留空表示订阅全部非支付事件'}
            optionList={eventOptions.map((e) => ({ value: e.code, label: e.label }))}
            onChange={(value) => {
              const events = (value as string[] | undefined) ?? [];
              setFormEvents(events);
              if (events.some((event) => SENSITIVE_EVENTS.has(event))) {
                modal.formApi.current?.setValue('signMode', 'hmacSha256');
              }
            }}
            rules={paymentScope ? [{ required: true, message: '请至少选择一个支付或退款事件' }] : undefined}
          />
          <Form.Select field="signMode" label="签名方式" style={{ width: '100%' }} optionList={SIGN_MODE_OPTIONS}
            disabled={formEvents.some((event) => SENSITIVE_EVENTS.has(event))}
            rules={[{ required: true, message: '请选择签名方式' }]} />
          <Form.TextArea field="headersText" label="自定义请求头" placeholder='JSON 格式，如 {"X-Custom":"abc"}（可选）' rows={2} />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} rules={[{ required: true, message: '请选择状态' }]} />
        </Form>
      </AppModal>

      {/* 一次性 secret */}
      <Modal title="请复制保存 Webhook 签名密钥" visible={secretModal} onCancel={() => setSecretModal(false)} footer={<Button type="primary" onClick={() => setSecretModal(false)}>我已复制，关闭</Button>} closeOnEsc={false} maskClosable={false}>
        <Banner type="warning" description="该签名密钥仅显示一次，用于校验 Webhook 请求的 X-Zenith-Signature。请立即复制保存。" style={{ marginBottom: 16 }} />
        <Paragraph copyable style={{ wordBreak: 'break-all', background: 'var(--semi-color-fill-0)', padding: 8, borderRadius: 'var(--semi-border-radius-small)' }}>{oneTimeSecret}</Paragraph>
      </Modal>

      {/* 投递日志抽屉 */}
      <SideSheet title={`投递日志 - ${drawerSub?.name ?? ''}`} visible={!!drawerSub} onCancel={() => setDrawerSub(null)} width={720}>
        <SearchToolbar>
          <FilterSelect
            placeholder="全部投递状态"
            items={OPEN_WEBHOOK_DELIVERY_STATUS_OPTIONS}
            value={deliveryStatus}
            onChange={(value) => {
              setDeliveryStatus(value as AppWebhookDelivery['status']);
              setDeliveryPage(1);
              clearDeliverySelection();
            }}
            width={140}
          />
          <FilterSelect
            placeholder="全部事件类型"
            items={eventOptions.map((event) => ({ value: event.code, label: event.label }))}
            value={deliveryEventType}
            onChange={(value) => {
              setDeliveryEventType(value as string);
              setDeliveryPage(1);
              clearDeliverySelection();
            }}
            width={180}
            filter
          />
          {selectedDeliveryIds.length > 0 && canManage && (
            <Button
              type="primary"
              loading={batchRetryMutation.isPending}
              onClick={() => void batchRetryDeliveries()}
            >
              批量重试（{selectedDeliveryIds.length}）
            </Button>
          )}
        </SearchToolbar>
        <ConfigurableTable
          bordered
          columns={deliveryColumns}
          dataSource={deliveries?.list ?? []}
          loading={deliveryQuery.isFetching}
          onRefresh={() => void deliveryQuery.refetch()}
          refreshLoading={deliveryQuery.isFetching}
          rowKey="id"
          size="small"
          empty="暂无投递记录"
          expandedRowRender={renderDeliveryExpanded}
          hideExpandedColumn={false}
          rowSelection={deliveryRowSelection}
          pagination={{
            currentPage: deliveryPage,
            pageSize: 10,
            total: deliveries?.total ?? 0,
            onPageChange: (p: number) => setDeliveryPage(p),
          }}
        />
      </SideSheet>
    </div>
  );
}
