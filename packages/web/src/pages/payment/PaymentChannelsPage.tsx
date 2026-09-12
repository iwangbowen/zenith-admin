import { useMemo, useEffect, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Button, Form, SideSheet, Spin, Toast, Tag, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_CHANNELS } from '@zenith/shared/payment';
import type { PaymentChannel, PaymentChannelConfig } from '@zenith/shared/payment';
import {
  paymentChannelKeys,
  useDeletePaymentChannels,
  usePaymentChannelDetail,
  usePaymentChannelList,
  useSavePaymentChannel,
  useSetDefaultPaymentChannel,
  useTestPaymentChannel,
} from '@/hooks/queries/payment-channels';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { PaymentChannelTag } from './payment-display';

interface SearchParams {
  keyword: string;
  channel?: string;
  status?: string;
}
const defaultSearch: SearchParams = { keyword: '', channel: undefined, status: undefined };

export default function PaymentChannelsPage() {
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentChannelKeys.lists });

  const [formChannel, setFormChannel] = useState<PaymentChannel>('wechat');

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);
  const listQuery = usePaymentChannelList({
    page,
    pageSize,
    ...filterQuery,
  });
  const saveMutation = useSavePaymentChannel();
  const modal = useEditModal<PaymentChannelConfig, Record<string, unknown>>({
    entityName: '支付渠道',
    save: saveMutation,
    useDetail: usePaymentChannelDetail,
    defaults: { channel: 'wechat', status: 'enabled', isDefault: false, sandbox: false, alipaySignType: 'RSA2' },
    toValues: (record) => ({
      name: record.name,
      channel: record.channel,
      status: record.status,
      isDefault: record.isDefault,
      sandbox: record.sandbox,
      notifyUrl: record.notifyUrl ?? '',
      remark: record.remark ?? '',
      wechatAppId: record.wechatAppId ?? '',
      wechatMchId: record.wechatMchId ?? '',
      wechatSerialNo: record.wechatSerialNo ?? '',
      wechatPlatformCert: record.wechatPlatformCert ?? '',
      alipayAppId: record.alipayAppId ?? '',
      alipayPublicKey: record.alipayPublicKey ?? '',
      alipaySignType: record.alipaySignType ?? 'RSA2',
      alipayGateway: record.alipayGateway ?? '',
      unionpayMerId: record.unionpayMerId ?? '',
      unionpayCertId: record.unionpayCertId ?? '',
      unionpayPublicKey: record.unionpayPublicKey ?? '',
      unionpayGateway: record.unionpayGateway ?? '',
    }),
    labelWidth: 96,
  });
  const editingDetail = modal.editing;
  const deleteMutation = useDeletePaymentChannels();
  const toggleMutation = useSavePaymentChannel();
  const testMutation = useTestPaymentChannel();
  const defaultMutation = useSetDefaultPaymentChannel();
  const testingId = testMutation.isPending ? (testMutation.variables?.params.id ?? null) : null;
  const defaultingId = defaultMutation.isPending ? (defaultMutation.variables?.params.id ?? null) : null;

  useEffect(() => {
    if (modal.visible && editingDetail?.channel) setFormChannel(editingDetail.channel);
  }, [editingDetail?.channel, modal.visible]);

  function openCreate() {
    setFormChannel('wechat');
    modal.openCreate();
  }
  function openEdit(record: PaymentChannelConfig) {
    setFormChannel(record.channel);
    modal.openEdit(record);
  }

  const secretPlaceholder = (has?: boolean) => (modal.isEdit && has ? '已配置，留空则不修改' : '请输入');

  const status = useStatusToggle<PaymentChannelConfig>({
    toggle: (record, checked) => toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    disabled: !hasPermission('payment:channel:update'),
  });

  function handleTest(record: PaymentChannelConfig) {
    testMutation.mutate({ params: { id: record.id } }, {
      onSuccess: ({ success, message, latencyMs }) => {
        if (success) Toast.success(`连通性测试通过（${latencyMs}ms）：${message}`);
        else Toast.error(`连通性测试失败：${message}`);
      },
    });
  }

  function handleSetDefault(record: PaymentChannelConfig) {
    defaultMutation.mutate({ params: { id: record.id } }, {
      onSuccess: () => Toast.success(`已将「${record.name}」设为默认${PAYMENT_CHANNEL_LABELS[record.channel]}渠道`),
    });
  }

  const columns: ColumnProps<PaymentChannelConfig>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 200, render: renderEllipsis },
    { title: '渠道', dataIndex: 'channel', width: 110, render: (v: PaymentChannel) => <PaymentChannelTag channel={v} /> },
    {
      // 「设为默认」在此列原位操作（非默认行点击即设），操作列因此无需「更多」收纳
      title: '默认', dataIndex: 'isDefault', width: 120,
      render: (v: boolean, r: PaymentChannelConfig) => {
        if (v) return <Tag color="amber">默认</Tag>;
        if (!hasPermission('payment:channel:update')) return EMPTY_PLACEHOLDER;
        return (
          <Button size="small" theme="borderless" type="tertiary" loading={defaultingId === r.id} onClick={() => handleSetDefault(r)}>
            设为默认
          </Button>
        );
      },
    },
    { title: '沙箱', dataIndex: 'sandbox', width: 80, render: (v: boolean) => (v ? <Tag color="grey">沙箱</Tag> : EMPTY_PLACEHOLDER) },
    dateTimeColumn('创建时间', 'createdAt'),
    status.column(),
    createOperationColumn<PaymentChannelConfig>({
      width: 210,
      actions: (r) => [
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
        deleteAction({
          hidden: !hasPermission('payment:channel:delete'),
          title: `删除渠道配置「${r.name}」？`,
          content: '删除后不可恢复；已产生订单或被支付应用绑定的配置无法删除，请改用停用',
          run: () => deleteMutation.mutateAsync([r.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称..." {...bindKeyword('keyword')} width={200} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部渠道"
              items={PAYMENT_CHANNEL_OPTIONS}
              {...bind('channel')}
            />
            <StatusSelect
              items={statusItems}
              {...bind('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('payment:channel:create') ? (
            <CreateButton onClick={openCreate} />
          ) : null
        )}
        filterTitle="支付渠道筛选"
      />

      <ConfigurableTable<PaymentChannelConfig>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={720}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}
            onValueChange={(v) => { if (v.channel) setFormChannel(v.channel as PaymentChannel); }}>
            <Row gutter={16}>
              <Col span={12}><Form.Input field="name" label="名称" placeholder="如：微信主商户" rules={[{ required: true, message: '名称不能为空' }]} /></Col>
              <Col span={12}><Form.Select field="channel" label="渠道" style={{ width: '100%' }} disabled={modal.isEdit} optionList={PAYMENT_CHANNEL_OPTIONS} rules={[{ required: true }]} /></Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} /></Col>
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

            {formChannel === 'unionpay' && (
              <>
                <Row gutter={16}>
                  <Col span={12}><Form.Input field="unionpayMerId" label="商户号" placeholder="云闪付商户号" rules={[{ required: true, message: '商户号不能为空' }]} /></Col>
                  <Col span={12}><Form.Input field="unionpayCertId" label="证书序列号" placeholder="证书序列号" /></Col>
                </Row>
                <Form.TextArea field="unionpayPrivateKey" label="商户私钥" autosize rows={3} placeholder={secretPlaceholder(editingDetail?.hasUnionpayPrivateKey)} />
                <Form.TextArea field="unionpayPublicKey" label="银联公钥" autosize rows={3} placeholder="银联验签公钥" />
                <Form.Input field="unionpayGateway" label="网关地址" placeholder="https://gateway.95516.com/gateway/api/backTransReq.do" />
              </>
            )}

            <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          </Form>
        </Spin>
      </SideSheet>
    </div>
  );
}
