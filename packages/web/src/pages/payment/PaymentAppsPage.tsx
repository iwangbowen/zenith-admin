import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Form, Input, Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useAllPaymentChannelConfigsLookup } from '@/hooks/queries/payment-channels';
import { paymentAppKeys, useDeletePaymentApp, usePaymentAppList, useSavePaymentApp } from '@/hooks/queries/payment-apps';
import { createdAtColumn } from '@/utils/table-columns';
import type { PaymentApp, PaymentChannel, PaymentChannelConfig } from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams { keyword: string; status: string; }
const defaultSearch: SearchParams = { keyword: '', status: '' };
const STATUS_COLOR = { enabled: 'green', disabled: 'grey' } as const satisfies Record<PaymentApp['status'], string>;
const STATUS_LABEL = { enabled: '启用', disabled: '停用' } as const satisfies Record<PaymentApp['status'], string>;

interface AppFormValues {
  name: string;
  appKey: string;
  status: PaymentApp['status'];
  wechatConfigId?: number | null;
  alipayConfigId?: number | null;
  unionpayConfigId?: number | null;
  remark?: string;
}

function channelOptions(configs: PaymentChannelConfig[], channel: PaymentChannel) {
  return configs
    .filter((item) => item.channel === channel)
    .map((item) => ({ value: item.id, label: item.name }));
}

export default function PaymentAppsPage() {
  const { items: statusItems } = useDictItems('common_status');
  const STATUS_OPTIONS = statusItems.map((i) => ({ value: i.value, label: i.label }));
  const { hasPermission } = usePermission();
  const canManage = hasPermission('payment:app:manage');
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentApp | null>(null);

  const listQuery = usePaymentAppList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const channelLookupQuery = useAllPaymentChannelConfigsLookup(modalVisible);
  const saveMutation = useSavePaymentApp();
  const deleteMutation = useDeletePaymentApp();
  const channelSelectOptions = useMemo(() => {
    const configs = channelLookupQuery.data ?? [];
    return {
      wechat: channelOptions(configs, 'wechat'),
      alipay: channelOptions(configs, 'alipay'),
      unionpay: channelOptions(configs, 'unionpay'),
    };
  }, [channelLookupQuery.data]);

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentAppKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setSubmittedParams(defaultSearch); setPage(1); void queryClient.invalidateQueries({ queryKey: paymentAppKeys.lists }); }
  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: PaymentApp) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); formApi.current = null; }

  async function handleOk() {
    let values: AppFormValues;
    try {
      values = (await formApi.current?.validate()) as AppFormValues;
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({
      id: editing?.id,
      values: {
        name: values.name,
        appKey: values.appKey,
        status: values.status,
        wechatConfigId: values.wechatConfigId ?? null,
        alipayConfigId: values.alipayConfigId ?? null,
        unionpayConfigId: values.unionpayConfigId ?? null,
        remark: values.remark || undefined,
      },
    });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const formInit: Partial<AppFormValues> = editing
    ? {
        name: editing.name,
        appKey: editing.appKey,
        status: editing.status,
        wechatConfigId: editing.wechatConfigId ?? null,
        alipayConfigId: editing.alipayConfigId ?? null,
        unionpayConfigId: editing.unionpayConfigId ?? null,
        remark: editing.remark ?? '',
      }
    : { status: 'enabled' };

  const columns: ColumnProps<PaymentApp>[] = [
    { title: '应用名称', dataIndex: 'name', width: 180 },
    { title: 'appKey', dataIndex: 'appKey', width: 180, render: (v: string) => <Typography.Text copyable={{ content: v }}>{v}</Typography.Text> },
    { title: '微信配置', dataIndex: 'wechatConfigName', width: 160, render: (v: string | null) => v || '-' },
    { title: '支付宝配置', dataIndex: 'alipayConfigName', width: 160, render: (v: string | null) => v || '-' },
    { title: '云闪付配置', dataIndex: 'unionpayConfigName', width: 160, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', width: 180, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v || '-'}</Typography.Text> },
    createdAtColumn as ColumnProps<PaymentApp>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentApp['status']) => <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag> },
    createOperationColumn<PaymentApp>({
      width: 120,
      actions: (r) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => openEdit(r) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: `删除应用「${r.name}」后不可恢复`,
              onOk: () => handleDelete(r.id),
            });
          },
        },
      ] : [],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input prefix={<Search size={14} />} placeholder="名称..." value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={STATUS_OPTIONS} />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }}
        description="业务方下单时携带 appKey，支付中心自动路由到该应用绑定的渠道配置" />
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderStatusFilter()}
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
        mobileFilters={renderStatusFilter()}
        filterTitle="支付应用筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={listQuery.data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal title={editing ? '编辑支付应用' : '新增支付应用'} visible={modalVisible} onOk={handleOk} onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }} width={620} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={110}>
          <Form.Input field="name" label="应用名称" placeholder="如：官网商城" rules={[{ required: true, message: '应用名称不能为空' }]} />
          <Form.Input field="appKey" label="appKey" placeholder="如：web-mall" disabled={!!editing} rules={[{ required: true, message: 'appKey 不能为空' }]} />
          <Form.Select field="wechatConfigId" label="微信配置" style={{ width: '100%' }} optionList={channelSelectOptions.wechat} showClear placeholder="可选" />
          <Form.Select field="alipayConfigId" label="支付宝配置" style={{ width: '100%' }} optionList={channelSelectOptions.alipay} showClear placeholder="可选" />
          <Form.Select field="unionpayConfigId" label="云闪付配置" style={{ width: '100%' }} optionList={channelSelectOptions.unionpay} showClear placeholder="可选" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={STATUS_OPTIONS} rules={[{ required: true, message: '请选择状态' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
