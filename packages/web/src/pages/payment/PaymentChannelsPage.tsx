import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Spin, Toast, Switch, Tag, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { PAYMENT_CHANNEL_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentChannelConfig } from '@zenith/shared';
import {
  paymentChannelKeys,
  useDeletePaymentChannel,
  usePaymentChannelDetail,
  usePaymentChannelList,
  useSavePaymentChannel,
  useSetDefaultPaymentChannel,
  useTestPaymentChannel,
} from '@/hooks/queries/payment-channels';

interface SearchParams {
  keyword: string;
  channel: string;
  status: string;
}
const defaultSearch: SearchParams = { keyword: '', channel: '', status: '' };

export default function PaymentChannelsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentChannelConfig | null>(null);
  const [formChannel, setFormChannel] = useState<PaymentChannel>('wechat');

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: paymentChannelKeys.lists });
  }
  function handleReset() {
    setDraftParams(defaultSearch);
    setSubmittedParams(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: paymentChannelKeys.lists });
  }

  const listQuery = usePaymentChannelList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    channel: submittedParams.channel || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data ?? null;
  const detailQuery = usePaymentChannelDetail(editing?.id, modalVisible);
  const editingDetail = editing ? (detailQuery.data ?? editing) : null;
  const detailLoading = !!editing && detailQuery.isFetching;
  const saveMutation = useSavePaymentChannel();
  const deleteMutation = useDeletePaymentChannel();
  const toggleMutation = useSavePaymentChannel();
  const testMutation = useTestPaymentChannel();
  const defaultMutation = useSetDefaultPaymentChannel();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;
  const testingId = testMutation.isPending ? (testMutation.variables ?? null) : null;
  const defaultingId = defaultMutation.isPending ? (defaultMutation.variables ?? null) : null;

  useEffect(() => {
    if (modalVisible && editingDetail?.channel) setFormChannel(editingDetail.channel);
  }, [editingDetail?.channel, modalVisible]);

  function openCreate() {
    setEditing(null);
    setFormChannel('wechat');
    setModalVisible(true);
  }
  function openEdit(record: PaymentChannelConfig) {
    setEditing(record);
    setFormChannel(record.channel);
    setModalVisible(true);
  }
  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const formInit = editingDetail
    ? {
        name: editingDetail.name,
        channel: editingDetail.channel,
        status: editingDetail.status,
        isDefault: editingDetail.isDefault,
        sandbox: editingDetail.sandbox,
        notifyUrl: editingDetail.notifyUrl ?? '',
        remark: editingDetail.remark ?? '',
        wechatAppId: editingDetail.wechatAppId ?? '',
        wechatMchId: editingDetail.wechatMchId ?? '',
        wechatSerialNo: editingDetail.wechatSerialNo ?? '',
        wechatPlatformCert: editingDetail.wechatPlatformCert ?? '',
        alipayAppId: editingDetail.alipayAppId ?? '',
        alipayPublicKey: editingDetail.alipayPublicKey ?? '',
        alipaySignType: editingDetail.alipaySignType ?? 'RSA2',
        alipayGateway: editingDetail.alipayGateway ?? '',
      }
    : { channel: 'wechat', status: 'enabled', isDefault: false, sandbox: false, alipaySignType: 'RSA2' };

  const secretPlaceholder = (has?: boolean) => (editing && has ? '已配置，留空则不修改' : '请输入');

  async function handleOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  function handleToggle(record: PaymentChannelConfig, checked: boolean) {
    toggleMutation.mutate(
      { id: record.id, values: { status: checked ? 'enabled' : 'disabled' } },
      { onSuccess: () => Toast.success(checked ? '已启用' : '已停用') },
    );
  }

  function handleTest(record: PaymentChannelConfig) {
    testMutation.mutate(record.id, {
      onSuccess: ({ success, message, latencyMs }) => {
        if (success) Toast.success(`连通性测试通过（${latencyMs}ms）：${message}`);
        else Toast.error(`连通性测试失败：${message}`);
      },
    });
  }

  function handleSetDefault(record: PaymentChannelConfig) {
    defaultMutation.mutate(record.id, {
      onSuccess: () => Toast.success(`已将「${record.name}」设为默认${PAYMENT_CHANNEL_LABELS[record.channel]}渠道`),
    });
  }

  const columns: ColumnProps<PaymentChannelConfig>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '渠道', dataIndex: 'channel', width: 110, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '默认', dataIndex: 'isDefault', width: 80, render: (v: boolean) => (v ? <Tag color="amber">默认</Tag> : '-') },
    { title: '沙箱', dataIndex: 'sandbox', width: 80, render: (v: boolean) => (v ? <Tag color="grey">沙箱</Tag> : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentChannelConfig) => (
        <Switch checked={r.status === 'enabled'} loading={togglingId === r.id} disabled={!hasPermission('payment:channel:update')} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    createOperationColumn<PaymentChannelConfig>({
      width: 250,
      actions: (r) => [
        ...(hasPermission('payment:channel:update') && !r.isDefault ? [{
          key: 'default',
          label: '设为默认',
          loading: defaultingId === r.id,
          onClick: () => handleSetDefault(r),
        }] : []),
        ...(hasPermission('payment:channel:update') ? [{
          key: 'test',
          label: '测试',
          loading: testingId === r.id,
          onClick: () => handleTest(r),
        }, {
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
        ...(hasPermission('payment:channel:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索名称..."
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
      showClear
      style={{ width: 200 }}
      onEnterPress={handleSearch}
    />
  );

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:channel:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderChannelFilter()}
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
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="支付渠道筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无数据"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal title={editing ? '编辑支付渠道' : '新增支付渠道'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending, disabled: detailLoading }} width={660} closeOnEsc>
        <Spin spinning={detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} allowEmpty initValues={formInit} labelPosition="left" labelWidth={96}
            onValueChange={(v) => { if (v.channel) setFormChannel(v.channel as PaymentChannel); }}>
            <Row gutter={16}>
              <Col span={12}><Form.Input field="name" label="名称" placeholder="如：微信主商户" rules={[{ required: true, message: '名称不能为空' }]} /></Col>
              <Col span={12}><Form.Select field="channel" label="渠道" style={{ width: '100%' }} disabled={!!editing} optionList={[{ value: 'wechat', label: '微信支付' }, { value: 'alipay', label: '支付宝' }]} rules={[{ required: true }]} /></Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} /></Col>
              <Col span={12}><Form.Switch field="isDefault" label="设为默认" /></Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Form.Switch field="sandbox" label="沙箱模式" /></Col>
            </Row>
            <Form.Input field="notifyUrl" label="回调基址" placeholder="如 https://your-host.com（留空用环境变量）" />

            {formChannel === 'wechat' && (
              <>
                <Row gutter={16}>
                  <Col span={12}><Form.Input field="wechatAppId" label="AppID" placeholder="公众号/小程序/APP AppID" /></Col>
                  <Col span={12}><Form.Input field="wechatMchId" label="商户号" placeholder="mchid" /></Col>
                </Row>
                <Form.Input field="wechatSerialNo" label="证书序列号" placeholder="商户 API 证书序列号" />
                <Form.Input field="wechatApiV3Key" label="APIv3 Key" mode="password" placeholder={secretPlaceholder(editingDetail?.hasWechatApiV3Key)} />
                <Form.TextArea field="wechatPrivateKey" label="商户私钥" autosize rows={3} placeholder={secretPlaceholder(editingDetail?.hasWechatPrivateKey)} />
                <Form.TextArea field="wechatPlatformCert" label="平台证书" autosize rows={3} placeholder="微信支付平台证书（PEM，验签用）" />
              </>
            )}

            {formChannel === 'alipay' && (
              <>
                <Row gutter={16}>
                  <Col span={12}><Form.Input field="alipayAppId" label="AppID" placeholder="支付宝应用 AppID" /></Col>
                  <Col span={12}><Form.Select field="alipaySignType" label="签名算法" style={{ width: '100%' }} optionList={[{ value: 'RSA2', label: 'RSA2' }, { value: 'RSA', label: 'RSA' }]} /></Col>
                </Row>
                <Form.TextArea field="alipayPrivateKey" label="应用私钥" autosize rows={3} placeholder={secretPlaceholder(editingDetail?.hasAlipayPrivateKey)} />
                <Form.TextArea field="alipayPublicKey" label="支付宝公钥" autosize rows={3} placeholder="支付宝公钥（PEM，验签用）" />
                <Form.Input field="alipayGateway" label="网关地址" placeholder="留空则按沙箱开关自动选择" />
              </>
            )}

            <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
