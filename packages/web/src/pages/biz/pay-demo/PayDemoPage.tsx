/**
 * 业务接入示例：支付接入（演示业务模块如何对接支付中心）
 *
 * 演示标准三步：① 业务自有实体落库（biz_pay_demos）；② 发起支付调用统一支付门面
 * createPayment 拿到二维码/跳转链接；③ 支付成功后由 paymentEventBus 订阅器按 bizType
 * 履约（置 paid、发放权益）。「模拟支付成功」用于在未配置真实渠道时演示完整闭环。
 */
import { useRef, useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banner, Button, Collapse, Form, Input, Modal, Select, Space, Tag, Toast, Tooltip, Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Info, Plus, RotateCcw, Search } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { BizPayDemo, BizPayDemoStatus, CreatePaymentResult, PaymentMethod } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { createdAtColumn } from '@/utils/table-columns';
import AppModal from '@/components/AppModal';
import {
  bizPayDemoKeys,
  useBizPayDemoList,
  useCreateBizPayDemo,
  useDeleteBizPayDemo,
  usePayBizPayDemo,
  useSimulateBizPayDemoPaid,
} from '@/hooks/queries/biz-pay-demo';

type TagColor = 'grey' | 'blue' | 'green' | 'orange';

const STATUS_MAP: Record<BizPayDemoStatus, { text: string; color: TagColor }> = {
  pending: { text: '待支付', color: 'grey' },
  paying: { text: '支付中', color: 'blue' },
  paid: { text: '已支付', color: 'green' },
  closed: { text: '已关闭', color: 'orange' },
};

const PAY_METHOD_OPTIONS = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }));

const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

const codeStyle: CSSProperties = {
  background: 'var(--semi-color-fill-0)', borderRadius: 6, padding: 12, margin: 0,
  overflowX: 'auto', fontSize: 12, lineHeight: 1.6,
  fontFamily: 'var(--semi-font-family-mono, ui-monospace, monospace)',
};

const payDemoBannerStyle: CSSProperties = {
  marginBottom: 12,
  background: 'var(--semi-color-primary-light-default)',
  borderColor: 'var(--semi-color-primary-light-active)',
  color: 'var(--semi-color-primary)',
};

const SNIPPET_BACKEND_PAY = `// 后端 · 发起支付：调用统一支付门面 createPayment（services/biz-pay-demo.service.ts）
const { orderNo, payParams } = await createPayment({
  bizType: 'biz_pay_demo',   // 业务类型标识（订阅器据此路由）
  bizId: String(demo.id),    // 业务方主键（履约时回填状态）
  subject: demo.subject,
  amount: demo.amount,       // 金额（整数分）
  payMethod,                 // wechat_native / alipay_page ...
  clientIp,
});
// 回填支付单号并置「支付中」，把 payParams（二维码/跳转链接）返回给前端
await db.update(bizPayDemos)
  .set({ status: 'paying', paymentOrderNo: orderNo, payMethod })
  .where(eq(bizPayDemos.id, demo.id));
return payParams;`;

const SNIPPET_BACKEND_SUB = `// 后端 · 监听支付成功并履约（services/biz-pay-demo-subscribers.ts）
paymentEventBus.on('payment.succeeded', (e) => {
  if (e.bizType !== 'biz_pay_demo') return;            // 只处理本业务的事件
  return markBizPayDemoPaid({ bizId: e.bizId, orderNo: e.orderNo, amount: e.amount });
});

// 履约（幂等）：按「主键 + 状态」原子更新，重复投递只生效一次
await db.update(bizPayDemos)
  .set({ status: 'paid', paidAt: new Date(), fulfillRemark: '已自动发放示例权益' })
  .where(and(eq(bizPayDemos.id, Number(bizId)), eq(bizPayDemos.status, 'paying')));`;

const SNIPPET_FRONTEND = `// 前端 · 发起支付并展示二维码（pages/biz/pay-demo/PayDemoPage.tsx）
const res = await request.post(\`/api/biz/pay-demos/\${id}/pay\`, { payMethod: 'wechat_native' });
const { payParams } = res.data;                 // { orderNo, codeUrl?, payUrl?, ... }

// 微信 native：渲染二维码供用户扫码
<QRCodeSVG value={payParams.codeUrl} size={200} />
// 支付成功后后端经 WebSocket 推送 'payment:success'，前端据此刷新列表（或主动查单）`;

interface PayDemoSearchParams {
  keyword: string;
  status: BizPayDemoStatus | '';
}

const DEFAULT_PAY_DEMO_SEARCH_PARAMS: PayDemoSearchParams = {
  keyword: '',
  status: '',
};

export default function PayDemoPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const [draftParams, setDraftParams] = useState<PayDemoSearchParams>(DEFAULT_PAY_DEMO_SEARCH_PARAMS);
  const [submittedParams, setSubmittedParams] = useState<PayDemoSearchParams>(DEFAULT_PAY_DEMO_SEARCH_PARAMS);

  const [createVisible, setCreateVisible] = useState(false);
  const createFormApi = useRef<FormApi | null>(null);

  const [payTarget, setPayTarget] = useState<BizPayDemo | null>(null);
  const payFormApi = useRef<FormApi | null>(null);

  const [payResult, setPayResult] = useState<CreatePaymentResult | null>(null);

  const listQuery = useBizPayDemoList({
    page,
    pageSize,
    keyword: submittedParams.keyword.trim() || undefined,
    status: submittedParams.status || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreateBizPayDemo();
  const payMutation = usePayBizPayDemo();
  const simulateMutation = useSimulateBizPayDemoPaid();
  const deleteMutation = useDeleteBizPayDemo();
  const simulatingId = simulateMutation.isPending ? (simulateMutation.variables ?? null) : null;

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: bizPayDemoKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams(DEFAULT_PAY_DEMO_SEARCH_PARAMS);
    setSubmittedParams(DEFAULT_PAY_DEMO_SEARCH_PARAMS);
    void queryClient.invalidateQueries({ queryKey: bizPayDemoKeys.lists });
  };

  const openCreate = () => {
    setCreateVisible(true);
    setTimeout(() => createFormApi.current?.reset(), 0);
  };

  const handleCreate = async () => {
    if (!createFormApi.current) return;
    let values: Record<string, unknown>;
    try { values = await createFormApi.current.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    await createMutation.mutateAsync({
      subject: String(values.subject ?? ''),
      amount: Math.round(Number(values.amount) * 100),
    });
    Toast.success('创建成功');
    setCreateVisible(false);
  };

  const openPay = (record: BizPayDemo) => {
    setPayTarget(record);
    setTimeout(() => payFormApi.current?.setValues({ payMethod: 'wechat_native' }), 0);
  };

  const handlePay = async () => {
    if (!payTarget || !payFormApi.current) return;
    let values: Record<string, unknown>;
    try { values = await payFormApi.current.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const data = await payMutation.mutateAsync({ id: payTarget.id, payMethod: values.payMethod as PaymentMethod });
    setPayTarget(null);
    setPayResult(data.payParams);
  };

  const handleSimulate = async (record: BizPayDemo) => {
    await simulateMutation.mutateAsync(record.id);
    Toast.success('已模拟支付成功，自动完成履约');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
  };

  const columns: ColumnProps<BizPayDemo>[] = [
    { title: '示例事项', dataIndex: 'subject', minWidth: 160 },
    { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (v: number) => yuan(v) },
    {
      title: '支付方式', dataIndex: 'payMethod', width: 130,
      render: (v: PaymentMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : <Typography.Text type="tertiary">—</Typography.Text>),
    },
    {
      title: '支付时间',
      dataIndex: 'paidAt',
      width: 190,
      render: (v: string | null) => (
        v
          ? <span style={{ whiteSpace: 'nowrap' }}>{v}</span>
          : <Typography.Text type="tertiary">—</Typography.Text>
      ),
    },
    createdAtColumn as ColumnProps<BizPayDemo>,
    {
      title: '状态', dataIndex: 'status', width: 100, fixed: 'right',
      render: (v: BizPayDemoStatus) => { const s = STATUS_MAP[v]; return s ? <Tag color={s.color}>{s.text}</Tag> : <span>{v}</span>; },
    },
    createOperationColumn<BizPayDemo>({
      width: 300,
      emptyContent: (record) => (
        record.status === 'paid'
          ? (
            <Tooltip content={record.fulfillRemark ?? '已履约'}>
              <Typography.Text
                type="tertiary"
                size="small"
                ellipsis
                style={{ maxWidth: 260 }}
              >
                {record.fulfillRemark ?? '已履约'}
              </Typography.Text>
            </Tooltip>
          )
          : undefined
      ),
      actions: (record) => [
        {
          key: 'pay',
          label: '发起支付',
          type: 'primary',
          hidden: record.status === 'paid' || record.status === 'closed',
          onClick: () => openPay(record),
        },
        {
          key: 'simulate',
          label: '模拟支付成功',
          hidden: record.status === 'paid' || record.status === 'closed',
          loading: simulatingId === record.id,
          onClick: () => {
            Modal.confirm({
              title: '模拟支付成功？',
              content: '触发后端履约（执行与真实支付成功相同的履约逻辑，演示用）',
              onOk: () => handleSimulate(record),
            });
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: record.status === 'paid',
          onClick: () => {
            Modal.confirm({
              title: '确定删除吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索示例事项"
      value={draftParams.keyword}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
      onEnterPress={handleSearch}
      showClear
      style={{ width: 220, maxWidth: '100%' }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.status || undefined}
      onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as PayDemoSearchParams['status']) ?? '' }))}
      showClear
      style={{ width: 140, maxWidth: '100%' }}
      optionList={(Object.keys(STATUS_MAP) as BizPayDemoStatus[]).map((value) => ({ value, label: STATUS_MAP[value].text }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新建示例单</Button>;

  return (
    <div className="page-container">
      <Banner
        type="info"
        closeIcon={null}
        icon={<Info size={18} style={{ color: 'var(--semi-color-primary)' }} />}
        style={payDemoBannerStyle}
        description="本页演示业务模块如何对接支付中心：新建示例单 → 发起支付（拿到二维码/跳转链接）→ 支付成功后由事件订阅器自动履约。未配置真实微信/支付宝渠道时，可点「模拟支付成功」跑通完整闭环。展开下方「前后端集成示例代码」查看接入方式。"
      />

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
        filterTitle="支付示例筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        columnSettingsKey="biz-pay-demo"
        pagination={buildPagination(total)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <Collapse style={{ marginTop: 16 }}>
        <Collapse.Panel header="前后端集成示例代码" itemKey="code">
          <Space vertical align="start" style={{ width: '100%' }} spacing={12}>
            <CodeBlock title="① 后端发起支付（统一支付门面）" code={SNIPPET_BACKEND_PAY} />
            <CodeBlock title="② 后端监听支付成功并履约（事件订阅）" code={SNIPPET_BACKEND_SUB} />
            <CodeBlock title="③ 前端发起支付并展示二维码" code={SNIPPET_FRONTEND} />
            <Typography.Text type="tertiary" size="small">
              金额全链路使用整数分；订阅者必须幂等（支付成功事件可能被低延迟投递与 cron 兜底重复投递）。详见文档站「支付中心 · 业务接入实战示例」。
            </Typography.Text>
          </Space>
        </Collapse.Panel>
      </Collapse>

      <AppModal
        title="新建支付示例单"
        visible={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={handleCreate}
        okButtonProps={{ loading: createMutation.isPending }}
        closeOnEsc
        width={480}
      >
        <Form getFormApi={(api) => { createFormApi.current = api; }} labelPosition="left" labelWidth={90} initValues={{ amount: 99 }}>
          <Form.Input field="subject" label="示例事项" placeholder="如 示例商品 A / 示例服务开通" rules={[{ required: true, message: '请输入示例事项名称' }]} />
          <Form.InputNumber field="amount" label="金额(元)" min={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '请输入金额' }]} />
        </Form>
      </AppModal>

      <AppModal
        title={`发起支付${payTarget ? ` · ${payTarget.subject}（${yuan(payTarget.amount)}）` : ''}`}
        visible={!!payTarget}
        onCancel={() => setPayTarget(null)}
        onOk={handlePay}
        okButtonProps={{ loading: payMutation.isPending }}
        okText="发起支付"
        closeOnEsc
        width={480}
      >
        <Form getFormApi={(api) => { payFormApi.current = api; }} labelPosition="left" labelWidth={90} initValues={{ payMethod: 'wechat_native' }}>
          <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={PAY_METHOD_OPTIONS} rules={[{ required: true, message: '请选择支付方式' }]} />
        </Form>
        <Typography.Text type="tertiary" size="small">
          将调用统一支付门面 createPayment 下单。未配置可用默认渠道时此处会失败，可改用列表中的「模拟支付成功」。
        </Typography.Text>
      </AppModal>

      <Modal title="支付下单结果" visible={!!payResult} onCancel={() => setPayResult(null)} footer={null} width={420} closeOnEsc>
        {payResult && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>订单号：{payResult.orderNo}</div>
            {payResult.codeUrl && (
              <>
                <QRCodeSVG value={payResult.codeUrl} size={200} style={{ margin: '12px auto', display: 'block' }} />
                <Typography.Text type="tertiary">请使用微信扫码支付</Typography.Text>
              </>
            )}
            {payResult.payUrl && (
              <div style={{ margin: '16px 0' }}>
                <Button type="primary" onClick={() => window.open(payResult.payUrl, '_blank', 'noopener')}>打开支付页</Button>
                <div style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 12 }}><Typography.Text type="tertiary">{payResult.payUrl}</Typography.Text></div>
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <Typography.Text type="tertiary" size="small">扫码支付成功后，后端订阅器会自动履约（本演示可关闭弹窗后点「模拟支付成功」）。</Typography.Text>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div style={{ width: '100%' }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>{title}</Typography.Text>
      <Typography.Paragraph copyable={{ content: code }} component="div" style={{ margin: 0 }}>
        <pre style={codeStyle}>{code}</pre>
      </Typography.Paragraph>
    </div>
  );
}
