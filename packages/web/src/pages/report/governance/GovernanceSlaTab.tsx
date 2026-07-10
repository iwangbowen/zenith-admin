import { useRef, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  Empty,
  Form,
  Modal,
  Row,
  Select,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportSlaRule, ReportSlaType, ReportSlaViolation, ReportSlaViolationStatus } from '@zenith/shared';
import { Plus } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEnabledReportDatasets } from '@/hooks/queries/report-datasets';
import {
  useDeleteReportSlaRule,
  useEvaluateReportSlaRule,
  useReportSlaRuleList,
  useReportSlaViolationList,
  useSaveReportSlaRule,
  useUpdateReportSlaViolation,
} from '@/hooks/queries/report-sla';
import { formatDateTime } from '@/utils/date';

const slaTypeOptions = [
  { value: 'freshness', label: '数据新鲜度' },
  { value: 'query_latency_p95', label: '查询 P95 延迟' },
  { value: 'availability', label: '可用性' },
  { value: 'dq_score', label: '质量评分' },
];
const severityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '严重' },
];

export default function GovernanceSlaTab() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [datasetId, setDatasetId] = useState<number | undefined>();
  const [type, setType] = useState<ReportSlaType | undefined>();
  const [violationStatus, setViolationStatus] = useState<ReportSlaViolationStatus | undefined>();
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportSlaRule | null>(null);

  const datasetsQuery = useEnabledReportDatasets();
  const datasetOptions = (datasetsQuery.data ?? []).map((item) => ({ value: item.id, label: item.name }));
  const rulesQuery = useReportSlaRuleList({ page, pageSize, datasetId, type });
  const violationsQuery = useReportSlaViolationList({ page, pageSize, datasetId, status: violationStatus });
  const saveMutation = useSaveReportSlaRule();
  const deleteMutation = useDeleteReportSlaRule();
  const evaluateMutation = useEvaluateReportSlaRule();
  const violationMutation = useUpdateReportSlaViolation();

  const openRule = (record?: ReportSlaRule) => {
    setEditing(record ?? null);
    setModalVisible(true);
  };
  const saveRule = async () => {
    try {
      const values = await formApi.current!.validate();
      await saveMutation.mutateAsync({
        id: editing?.id,
        values: {
          ...values,
          warningValue: values.warningValue ?? null,
          cron: values.cron || null,
          recipients: values.recipients || null,
          webhookUrl: values.webhookUrl || null,
          channels: values.channels ?? [],
        },
      });
      Toast.success(editing ? 'SLA 规则已更新' : 'SLA 规则已创建');
      setModalVisible(false);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : 'SLA 规则保存失败');
    }
  };
  const evaluate = async (record: ReportSlaRule) => {
    try {
      await evaluateMutation.mutateAsync(record.id);
      Toast.success('SLA 评估任务已提交，可在顶部全局任务托盘查看进度');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : 'SLA 评估提交失败');
    }
  };
  const updateViolation = (record: ReportSlaViolation, status: 'acknowledged' | 'resolved') => {
    Modal.confirm({
      title: status === 'acknowledged' ? '确认已知悉 SLA 违规？' : '确认 SLA 违规已解决？',
      content: `观测值 ${record.observedValue}，目标值 ${record.targetValue}`,
      onOk: async () => {
        await violationMutation.mutateAsync({ id: record.id, values: { status } });
        Toast.success(status === 'acknowledged' ? '违规已确认' : '违规已解决');
      },
    });
  };

  const ruleColumns: ColumnProps<ReportSlaRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 190 },
    { title: '数据集 ID', dataIndex: 'datasetId', width: 110 },
    { title: '类型', dataIndex: 'type', width: 150, render: (v) => slaTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '目标/预警', width: 130, render: (_v, r) => `${r.targetValue} / ${r.warningValue ?? '—'}` },
    { title: '窗口', dataIndex: 'windowMinutes', width: 100, render: (v) => `${v} 分钟` },
    { title: '调度', width: 180, render: (_v, r) => r.cron ? `${r.cron} · ${r.timezone}` : '仅手动' },
    { title: '最近评估', dataIndex: 'lastEvaluatedAt', width: 170, render: (v) => v ? formatDateTime(v) : '—' },
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (v) => <Tag color={v ? 'green' : 'grey'}>{v ? '启用' : '停用'}</Tag>,
    },
    createOperationColumn<ReportSlaRule>({
      width: 180,
      desktopInlineKeys: ['evaluate', 'edit'],
      actions: (record) => [
        { key: 'evaluate', label: '评估', hidden: !hasPermission('report:sla:evaluate'), loading: evaluateMutation.isPending && evaluateMutation.variables === record.id, onClick: () => void evaluate(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:sla:update'), onClick: () => openRule(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:sla:delete'),
          onClick: () => { Modal.confirm({
            title: `删除 SLA 规则「${record.name}」？`,
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await deleteMutation.mutateAsync(record.id); Toast.success('SLA 规则已删除'); },
          }); },
        },
      ],
    }),
  ];
  const violationColumns: ColumnProps<ReportSlaViolation>[] = [
    { title: '规则 ID', dataIndex: 'ruleId', width: 100 },
    { title: '数据集 ID', dataIndex: 'datasetId', width: 110 },
    { title: '观测/目标', width: 130, render: (_v, r) => `${r.observedValue} / ${r.targetValue}` },
    { title: '窗口开始', dataIndex: 'windowStartedAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '窗口结束', dataIndex: 'windowEndedAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '详情', dataIndex: 'detail', width: 230, render: (v) => v || '—' },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v) => <Tag color={v === 'open' ? 'red' : v === 'resolved' ? 'green' : 'orange'}>{v}</Tag> },
    createOperationColumn<ReportSlaViolation>({
      width: 150,
      actions: (record) => [
        { key: 'ack', label: '确认', hidden: !hasPermission('report:sla:update') || record.status !== 'open', onClick: () => updateViolation(record, 'acknowledged') },
        { key: 'resolve', label: '解决', hidden: !hasPermission('report:sla:update') || record.status === 'resolved', onClick: () => updateViolation(record, 'resolved') },
      ],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <Select placeholder="数据集" filter showClear value={datasetId} optionList={datasetOptions} style={{ width: 180 }} onChange={(v) => { setPage(1); setDatasetId(v as number | undefined); }} />
        <Select placeholder="SLA 类型" showClear value={type} optionList={slaTypeOptions} style={{ width: 160 }} onChange={(v) => { setPage(1); setType(v as ReportSlaType | undefined); }} />
        {hasPermission('report:sla:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={() => openRule()}>新增规则</Button> : null}
      </SearchToolbar>
      {rulesQuery.isError && <Banner type="danger" description="SLA 规则加载失败" />}
      <ConfigurableTable bordered rowKey="id" columns={ruleColumns} dataSource={rulesQuery.data?.list ?? []} loading={rulesQuery.isFetching} empty={<Empty title="暂无 SLA 规则" />} pagination={buildPagination(rulesQuery.data?.total ?? 0)} onRefresh={() => void rulesQuery.refetch()} refreshLoading={rulesQuery.isFetching} />
      <Typography.Title heading={5} style={{ marginTop: 20 }}>SLA 违规</Typography.Title>
      <SearchToolbar>
        <Select placeholder="违规状态" showClear value={violationStatus} optionList={['open', 'acknowledged', 'resolved'].map((value) => ({ value, label: value }))} style={{ width: 150 }} onChange={(v) => setViolationStatus(v as ReportSlaViolationStatus | undefined)} />
      </SearchToolbar>
      {violationsQuery.isError && <Banner type="danger" description="SLA 违规加载失败" />}
      <ConfigurableTable bordered rowKey="id" columns={violationColumns} dataSource={violationsQuery.data?.list ?? []} loading={violationsQuery.isFetching} empty={<Empty title="暂无 SLA 违规" />} pagination={buildPagination(violationsQuery.data?.total ?? 0)} onRefresh={() => void violationsQuery.refetch()} refreshLoading={violationsQuery.isFetching} />

      <AppModal title={editing ? '编辑 SLA 规则' : '新增 SLA 规则'} visible={modalVisible} width={720} confirmLoading={saveMutation.isPending} onOk={() => void saveRule()} onCancel={() => setModalVisible(false)} closeOnEsc>
        <Form key={editing?.id ?? 'create'} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={100} initValues={editing ?? { type: 'freshness', targetValue: 60, windowMinutes: 60, timezone: 'Asia/Shanghai', severity: 'high', channels: [], silenceMins: 60, enabled: true }}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Input field="name" label="规则名称" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="datasetId" label="数据集" filter style={{ width: '100%' }} optionList={datasetOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="type" label="SLA 类型" style={{ width: '100%' }} optionList={slaTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="severity" label="严重度" style={{ width: '100%' }} optionList={severityOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="targetValue" label="目标值" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="warningValue" label="预警值" min={0} style={{ width: '100%' }} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="windowMinutes" label="统计窗口" min={1} suffix="分钟" style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Input field="cron" label="Cron" placeholder="留空仅手动评估" /></Col>
            <Col xs={24} md={12}><Form.Input field="timezone" label="时区" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="silenceMins" label="静默分钟" min={0} style={{ width: '100%' }} /></Col>
          </Row>
          <Form.Select multiple field="channels" label="通知渠道" style={{ width: '100%' }} optionList={[{ value: 'email', label: '邮件' }, { value: 'inApp', label: '站内信' }, { value: 'webhook', label: 'Webhook' }]} />
          <Form.Input field="recipients" label="邮件收件人" placeholder="多个邮箱以逗号分隔" />
          <Form.Input field="webhookUrl" label="Webhook" />
          <Form.Switch field="enabled" label="启用规则" />
        </Form>
      </AppModal>
    </>
  );
}
