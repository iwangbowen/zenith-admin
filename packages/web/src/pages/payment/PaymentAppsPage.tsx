import { useMemo, useState } from 'react';
import { Banner, Form, Tag } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AppModal } from '@/components/AppModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useAllPaymentChannelConfigsLookup } from '@/hooks/queries/payment-channels';
import { paymentAppKeys, useDeletePaymentApp, usePaymentAppList, useSavePaymentApp } from '@/hooks/queries/payment-apps';
import { useOpenAppOptions } from '@/hooks/queries/open-platform';
import { EMPTY_PLACEHOLDER, copyableNoColumn, createdAtColumn, renderEllipsis, renderEnabledStatusTag } from '@/utils/table-columns';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreatePaymentAppInput, PaymentApp, PaymentChannel, PaymentChannelConfig } from '@zenith/shared/payment';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';

interface SearchParams { keyword: string; status?: string; }
const defaultSearch: SearchParams = { keyword: '', status: undefined };
interface AppFormValues {
  name: string;
  openClientId: number;
  status: PaymentApp['status'];
  wechatConfigId?: number | null;
  alipayConfigId?: number | null;
  unionpayConfigId?: number | null;
  remark?: string;
}

function channelOptions(configs: PaymentChannelConfig[], channel: PaymentChannel, environment: PaymentApp['environment'] | null) {
  return configs
    .filter((item) => item.channel === channel && item.status === 'enabled' && environment != null && item.sandbox === (environment === 'sandbox'))
    .map((item) => ({ value: item.id, label: item.name }));
}

export default function PaymentAppsPage() {
  const { options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canManage = hasPermission('payment:app:manage');
  const [environmentWatch, setEnvironmentWatch] = useState<PaymentApp['environment'] | null>(null);
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentAppKeys.lists });
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);
  const listQuery = usePaymentAppList({
    page,
    pageSize,
    ...filterQuery,
  });
  const saveMutation = useSavePaymentApp();
  const modal = useEditModal<PaymentApp, AppFormValues, Partial<CreatePaymentAppInput>>({
    entityName: '支付应用',
    save: saveMutation,
    defaults: { status: 'enabled' },
    toValues: (record) => ({
      name: record.name,
      openClientId: record.openClientId,
      status: record.status,
      wechatConfigId: record.wechatConfigId ?? null,
      alipayConfigId: record.alipayConfigId ?? null,
      unionpayConfigId: record.unionpayConfigId ?? null,
      remark: record.remark ?? '',
    }),
    beforeSave: (values, { isEdit }) => ({
      name: values.name,
      ...(!isEdit ? { openClientId: values.openClientId } : {}),
      status: values.status,
      wechatConfigId: values.wechatConfigId ?? null,
      alipayConfigId: values.alipayConfigId ?? null,
      unionpayConfigId: values.unionpayConfigId ?? null,
      remark: values.remark || undefined,
    }),
    labelWidth: 110,
  });
  const channelLookupQuery = useAllPaymentChannelConfigsLookup(modal.visible);
  const openClientQuery = useOpenAppOptions({ enabled: modal.visible && !modal.isEdit });
  const deleteMutation = useDeletePaymentApp();
  const eligibleOpenClients = useMemo(
    () => (openClientQuery.data ?? []).filter((client) => client.reviewStatus === 'approved' && !client.isPublic && client.signEnabled),
    [openClientQuery.data],
  );
  const openClientOptions = useMemo(
    () => eligibleOpenClients.map((client) => ({
      value: client.id,
      label: `${client.name} · ${client.clientId} · ${client.environment === 'sandbox' ? '沙箱' : '生产'}`,
    })),
    [eligibleOpenClients],
  );
  const openClientById = useMemo(() => new Map(eligibleOpenClients.map((client) => [client.id, client])), [eligibleOpenClients]);
  const channelSelectOptions = useMemo(() => {
    const configs = channelLookupQuery.data ?? [];
    return {
      wechat: channelOptions(configs, 'wechat', environmentWatch),
      alipay: channelOptions(configs, 'alipay', environmentWatch),
      unionpay: channelOptions(configs, 'unionpay', environmentWatch),
    };
  }, [channelLookupQuery.data, environmentWatch]);

  function openCreate() {
    setEnvironmentWatch(null);
    modal.openCreate();
  }

  function openEdit(record: PaymentApp) {
    setEnvironmentWatch(record.environment);
    modal.openEdit(record);
  }

  const columns: ColumnProps<PaymentApp>[] = [
    { title: '应用名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '开放客户端', dataIndex: 'openClientName', width: 180, render: renderEllipsis },
    copyableNoColumn('Client ID', 'openClientKey', { width: 260 }),
    { title: '环境', dataIndex: 'environment', width: 90, render: (v: PaymentApp['environment']) => <Tag color={v === 'sandbox' ? 'orange' : 'blue'}>{v === 'sandbox' ? '沙箱' : '生产'}</Tag> },
    { title: '微信配置', dataIndex: 'wechatConfigName', width: 160, render: renderEllipsis },
    { title: '支付宝配置', dataIndex: 'alipayConfigName', width: 160, render: renderEllipsis },
    { title: '云闪付配置', dataIndex: 'unionpayConfigName', width: 160, render: renderEllipsis },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    createdAtColumn as ColumnProps<PaymentApp>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: renderEnabledStatusTag },
    createOperationColumn<PaymentApp>({
      width: 150,
      actions: (r) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => openEdit(r) },
        deleteAction({
          title: '确定要删除吗？',
          content: `删除应用「${r.name}」后不可恢复`,
          run: () => deleteMutation.mutateAsync([r.id]),
        }),
      ] : [],
    }),
  ];

  return (
    <div className="page-container">
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }}
        description="支付应用绑定已审核的 Open OAuth 客户端，并按客户端环境路由同环境商户配置" />
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="名称..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <StatusSelect
            items={statusOptions}
            {...bind('status')}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canManage ? <CreateButton onClick={openCreate} /> : null}
        filterTitle="支付应用筛选"
      />

      <ConfigurableTable<PaymentApp>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={620}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="name" label="应用名称" placeholder="如：官网商城" rules={[{ required: true, message: '应用名称不能为空' }]} />
          {modal.isEdit ? (
            <Form.Slot label="开放客户端">
              {modal.editing ? `${modal.editing.openClientName} · ${modal.editing.openClientKey}` : EMPTY_PLACEHOLDER}
            </Form.Slot>
          ) : (
            <Form.Select
              field="openClientId"
              label="开放客户端"
              style={{ width: '100%' }}
              optionList={openClientOptions}
              filter
              loading={openClientQuery.isFetching}
              onChange={(value) => {
                setEnvironmentWatch(openClientById.get(value as number)?.environment ?? null);
                modal.formApi.current?.setValue('wechatConfigId', null);
                modal.formApi.current?.setValue('alipayConfigId', null);
                modal.formApi.current?.setValue('unionpayConfigId', null);
              }}
              rules={[{ required: true, message: '请选择已审核的开放客户端' }]}
            />
          )}
          <Form.Select field="wechatConfigId" label="微信配置" style={{ width: '100%' }} optionList={channelSelectOptions.wechat} showClear placeholder="可选" />
          <Form.Select field="alipayConfigId" label="支付宝配置" style={{ width: '100%' }} optionList={channelSelectOptions.alipay} showClear placeholder="可选" />
          <Form.Select field="unionpayConfigId" label="云闪付配置" style={{ width: '100%' }} optionList={channelSelectOptions.unionpay} showClear placeholder="可选" />
          <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} rules={[{ required: true, message: '请选择状态' }]} />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
