import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  Button,
  Col,
  Empty,
  Form,
  Modal,
  Progress,
  Row,
  Select,
  SideSheet,
  Space,
  Switch,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type {
  ReportDqAnomaly,
  ReportDqAnomalyStatus,
  ReportDqRule,
  ReportDqRuleType,
  ReportDqRun,
  ReportDqRunStatus,
  ReportDqScore,
} from '@zenith/shared';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  reportDqKeys,
  useCurrentReportDqScore,
  useDeleteReportDqRule,
  useReportDqAnomalyList,
  useReportDqRuleList,
  useReportDqRunList,
  useReportDqScoreHistory,
  useRunReportDqRule,
  useSaveReportDqRule,
  useToggleReportDqRule,
  useUpdateReportDqAnomalyStatus,
} from '@/hooks/queries/report-dq';
import { useEnabledReportDatasets } from '@/hooks/queries/report-datasets';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { dqRunStatusLabel, dqTaskSubmissionMessage, normalizeDqRuleFormValues } from './report-platform-utils';

const ruleTypeOptions = [
  { value: 'not_null', label: '非空' },
  { value: 'uniqueness', label: '唯一性' },
  { value: 'range', label: '范围' },
  { value: 'pattern', label: '正则模式' },
  { value: 'freshness', label: '新鲜度' },
  { value: 'row_count', label: '行数' },
  { value: 'custom_sql', label: '自定义 SQL' },
];
const severityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '严重' },
];
const severityColor = { low: 'grey', medium: 'blue', high: 'orange', critical: 'red' } as const;
const runStatusColor: Record<ReportDqRunStatus, 'grey' | 'blue' | 'green' | 'red' | 'amber'> = {
  pending: 'grey', running: 'blue', succeeded: 'green', failed: 'red', cancelled: 'amber',
};

function RuleConfigFields({ type }: Readonly<{ type: ReportDqRuleType }>) {
  if (type === 'range') return (
    <Row gutter={16}>
      <Col xs={24} md={12}><Form.InputNumber field="min" label="最小值" style={{ width: '100%' }} /></Col>
      <Col xs={24} md={12}><Form.InputNumber field="max" label="最大值" style={{ width: '100%' }} /></Col>
    </Row>
  );
  if (type === 'pattern') return <Form.Input field="pattern" label="正则表达式" rules={[{ required: true, message: '请输入正则表达式' }]} />;
  if (type === 'freshness') return <Form.InputNumber field="maxAgeMinutes" label="最大延迟" suffix="分钟" min={1} style={{ width: '100%' }} rules={[{ required: true }]} />;
  if (type === 'row_count') return (
    <Row gutter={16}>
      <Col xs={24} md={12}><Form.InputNumber field="minRows" label="最少行数" min={0} style={{ width: '100%' }} /></Col>
      <Col xs={24} md={12}><Form.InputNumber field="maxRows" label="最多行数" min={0} style={{ width: '100%' }} /></Col>
    </Row>
  );
  if (type === 'custom_sql') return <Form.TextArea field="sql" label="校验 SQL" autosize rows={5} rules={[{ required: true, message: '请输入安全只读 SQL' }]} />;
  return null;
}

export default function QualityPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [activeTab, setActiveTab] = useState('rules');
  const [datasetId, setDatasetId] = useState<number | undefined>();
  const [ruleType, setRuleType] = useState<ReportDqRuleType | undefined>();
  const [enabled, setEnabled] = useState<boolean | undefined>();
  const [submitted, setSubmitted] = useState({
    datasetId: undefined as number | undefined,
    ruleType: undefined as ReportDqRuleType | undefined,
    enabled: undefined as boolean | undefined,
    anomalyStatus: undefined as ReportDqAnomalyStatus | undefined,
    runStatus: undefined as ReportDqRunStatus | undefined,
  });
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDqRule | null>(null);
  const [formRuleType, setFormRuleType] = useState<ReportDqRuleType>('not_null');
  const [historyRule, setHistoryRule] = useState<ReportDqRule | null>(null);
  const [anomalyStatus, setAnomalyStatus] = useState<ReportDqAnomalyStatus | undefined>();
  const [runStatus, setRunStatus] = useState<ReportDqRunStatus | undefined>();

  const datasetsQuery = useEnabledReportDatasets();
  const datasetOptions = (datasetsQuery.data ?? []).map((item) => ({ value: item.id, label: item.name }));
  const rulesQuery = useReportDqRuleList({ page, pageSize, datasetId: submitted.datasetId, type: submitted.ruleType, enabled: submitted.enabled });
  const runsQuery = useReportDqRunList({ page, pageSize, datasetId: submitted.datasetId, status: submitted.runStatus });
  const historyQuery = useReportDqRunList({ page: 1, pageSize: 30, ruleId: historyRule?.id });
  const anomaliesQuery = useReportDqAnomalyList({ page, pageSize, datasetId: submitted.datasetId, status: submitted.anomalyStatus });
  const currentScoreQuery = useCurrentReportDqScore(submitted.datasetId, activeTab === 'scores');
  const scoresQuery = useReportDqScoreHistory(submitted.datasetId, { page, pageSize }, activeTab === 'scores');
  const saveMutation = useSaveReportDqRule();
  const deleteMutation = useDeleteReportDqRule();
  const toggleMutation = useToggleReportDqRule();
  const runMutation = useRunReportDqRule();
  const anomalyMutation = useUpdateReportDqAnomalyStatus();

  const applySearch = () => {
    setPage(1);
    setSubmitted({ datasetId, ruleType, enabled, anomalyStatus, runStatus });
    void qc.invalidateQueries({ queryKey: reportDqKeys.lists });
  };
  const resetSearch = () => {
    setPage(1);
    setDatasetId(undefined);
    setRuleType(undefined);
    setEnabled(undefined);
    setAnomalyStatus(undefined);
    setRunStatus(undefined);
    setSubmitted({ datasetId: undefined, ruleType: undefined, enabled: undefined, anomalyStatus: undefined, runStatus: undefined });
    void qc.invalidateQueries({ queryKey: reportDqKeys.lists });
  };

  const openCreate = () => {
    setEditing(null);
    setFormRuleType('not_null');
    setModalVisible(true);
  };
  const openEdit = (record: ReportDqRule) => {
    setEditing(record);
    setFormRuleType(record.type);
    setModalVisible(true);
  };
  const saveRule = async () => {
    try {
      const values = await formApi.current!.validate();
      await saveMutation.mutateAsync({ id: editing?.id, values: normalizeDqRuleFormValues(values, !!editing) });
      Toast.success(editing ? '质量规则已更新' : '质量规则已创建');
      setModalVisible(false);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '质量规则保存失败');
    }
  };
  const runRule = async (record: ReportDqRule) => {
    try {
      const task = await runMutation.mutateAsync({ id: record.id, values: { sampleLimit: 20 } });
      Toast.success(dqTaskSubmissionMessage(task));
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '质量任务提交失败');
    }
  };
  const updateAnomaly = (record: ReportDqAnomaly, status: 'acknowledged' | 'resolved') => {
    Modal.confirm({
      title: status === 'acknowledged' ? '确认已知悉该异常？' : '确认该异常已解决？',
      content: record.title,
      onOk: async () => {
        await anomalyMutation.mutateAsync({ id: record.id, values: { status } });
        Toast.success(status === 'acknowledged' ? '异常已确认' : '异常已解决');
      },
    });
  };

  const ruleColumns: ColumnProps<ReportDqRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: (v) => v || '—' },
    { title: '类型', dataIndex: 'type', width: 120, render: (v) => ruleTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '字段', dataIndex: 'field', width: 120, render: (v) => v || '—' },
    { title: '严重度', dataIndex: 'severity', width: 90, render: (v: ReportDqRule['severity']) => <Tag color={severityColor[v]}>{severityOptions.find((i) => i.value === v)?.label}</Tag> },
    { title: '调度', width: 180, render: (_v, r) => r.cron ? `${r.cron} · ${r.timezone}` : '仅手动' },
    { title: '最近运行', dataIndex: 'lastRunAt', width: 170, render: (v) => v ? formatDateTime(v) : '—' },
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (v: boolean, r) => <Switch size="small" checked={v} disabled={!hasPermission('report:dq:update')} loading={toggleMutation.isPending && toggleMutation.variables === r.id} onChange={() => toggleMutation.mutate(r.id)} />,
    },
    createOperationColumn<ReportDqRule>({
      width: 190,
      desktopInlineKeys: ['run', 'edit'],
      actions: (record) => [
        { key: 'run', label: '执行', hidden: !hasPermission('report:dq:run'), loading: runMutation.isPending && runMutation.variables?.id === record.id, onClick: () => void runRule(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:dq:update'), onClick: () => openEdit(record) },
        { key: 'history', label: '运行历史', onClick: () => setHistoryRule(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:dq:delete'),
          onClick: () => { Modal.confirm({
            title: `删除规则「${record.name}」？`,
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await deleteMutation.mutateAsync(record.id); Toast.success('规则已删除'); },
          }); },
        },
      ],
    }),
  ];
  const runColumns: ColumnProps<ReportDqRun>[] = [
    { title: '规则 ID', dataIndex: 'ruleId', width: 100 },
    { title: '数据集 ID', dataIndex: 'datasetId', width: 110 },
    { title: '触发方式', dataIndex: 'triggerType', width: 110 },
    { title: '检查/失败行', width: 140, render: (_v, r) => `${r.checkedRows} / ${r.failedRows}` },
    { title: '通过率', dataIndex: 'passRate', width: 100, render: (v) => v == null ? '—' : `${(Number(v) * 100).toFixed(2)}%` },
    { title: '耗时', dataIndex: 'durationMs', width: 100, render: (v) => v == null ? '—' : `${v}ms` },
    { title: '开始时间', dataIndex: 'startedAt', width: 170, render: (v) => v ? formatDateTime(v) : '—' },
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v: ReportDqRunStatus) => <Tag color={runStatusColor[v]}>{dqRunStatusLabel(v)}</Tag> },
  ];
  const anomalyColumns: ColumnProps<ReportDqAnomaly>[] = [
    { title: '异常', dataIndex: 'title', width: 230, render: renderEllipsis },
    { title: '数据集 ID', dataIndex: 'datasetId', width: 110 },
    { title: '规则 ID', dataIndex: 'ruleId', width: 100, render: (v) => v || '—' },
    { title: '严重度', dataIndex: 'severity', width: 90, render: (v: ReportDqAnomaly['severity']) => <Tag color={severityColor[v]}>{v}</Tag> },
    { title: '详情', dataIndex: 'detail', width: 260, render: renderEllipsis },
    { title: '发现时间', dataIndex: 'createdAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v) => <Tag>{v}</Tag> },
    createOperationColumn<ReportDqAnomaly>({
      width: 150,
      actions: (record) => [
        { key: 'ack', label: '确认', hidden: !hasPermission('report:dq:update') || record.status !== 'open', onClick: () => updateAnomaly(record, 'acknowledged') },
        { key: 'resolve', label: '解决', hidden: !hasPermission('report:dq:update') || !['open', 'acknowledged'].includes(record.status), onClick: () => updateAnomaly(record, 'resolved') },
      ],
    }),
  ];
  const scoreColumns: ColumnProps<ReportDqScore>[] = [
    { title: '评分', dataIndex: 'score', width: 120, render: (v) => <Progress percent={Number(v)} showInfo type="line" /> },
    { title: '规则总数', dataIndex: 'totalRules', width: 100 },
    { title: '通过', dataIndex: 'passedRules', width: 90 },
    { title: '失败', dataIndex: 'failedRules', width: 90 },
    { title: '维度明细', dataIndex: 'dimensions', width: 260, render: (v) => JSON.stringify(v) },
    { title: '测量时间', dataIndex: 'measuredAt', width: 170, render: (v) => formatDateTime(v) },
  ];

  const datasetFilter = <Select placeholder="选择数据集" filter showClear value={datasetId} optionList={datasetOptions} style={{ width: 190 }} onChange={(v) => setDatasetId(v as number | undefined)} />;
  const searchButtons = <><Button type="primary" icon={<Search size={14} />} onClick={applySearch}>查询</Button><Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetSearch}>重置</Button></>;
  const commonToolbar = (extraFilters?: React.ReactNode, actions?: React.ReactNode) => (
    <SearchToolbar
      primary={<>{datasetFilter}{searchButtons}</>}
      filters={extraFilters}
      actions={actions}
      mobilePrimary={<>{datasetFilter}<Button type="primary" icon={<Search size={14} />} onClick={applySearch}>查询</Button>{actions}</>}
      onFilterApply={applySearch}
      onFilterReset={resetSearch}
    />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" activeKey={activeTab} onChange={(key) => { setActiveTab(key); setPage(1); }}>
        <TabPane tab="质量规则" itemKey="rules">
          {commonToolbar(
            <>
              <Select placeholder="规则类型" showClear value={ruleType} optionList={ruleTypeOptions} style={{ width: 140 }} onChange={(v) => setRuleType(v as ReportDqRuleType | undefined)} />
              <Select placeholder="启用状态" showClear value={enabled === undefined ? undefined : String(enabled)} optionList={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]} style={{ width: 120 }} onChange={(v) => setEnabled(v == null ? undefined : v === 'true')} />
            </>,
            hasPermission('report:dq:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null,
          )}
          {rulesQuery.isError && <Banner type="danger" description={rulesQuery.error instanceof Error ? rulesQuery.error.message : '质量规则加载失败'} />}
          <ConfigurableTable bordered rowKey="id" columns={ruleColumns} dataSource={rulesQuery.data?.list ?? []} loading={rulesQuery.isFetching} empty={<Empty title="暂无质量规则" />} pagination={buildPagination(rulesQuery.data?.total ?? 0)} onRefresh={() => void rulesQuery.refetch()} refreshLoading={rulesQuery.isFetching} />
        </TabPane>
        <TabPane tab="数据集评分" itemKey="scores">
          {commonToolbar()}
          {!submitted.datasetId && <Banner type="info" description="请选择数据集后查看质量评分与趋势。" />}
          {currentScoreQuery.isError && <Banner type="danger" description="当前评分加载失败" />}
          {currentScoreQuery.data && (
            <Space spacing={24} style={{ margin: '8px 0 16px' }}>
              <Typography.Title heading={3}>{currentScoreQuery.data.score.toFixed(1)}</Typography.Title>
              <Typography.Text>通过 {currentScoreQuery.data.passedRules} / {currentScoreQuery.data.totalRules} 条规则</Typography.Text>
              <Typography.Text type={currentScoreQuery.data.failedRules ? 'danger' : 'success'}>失败 {currentScoreQuery.data.failedRules}</Typography.Text>
            </Space>
          )}
          <ConfigurableTable bordered rowKey="id" columns={scoreColumns} dataSource={scoresQuery.data?.list ?? []} loading={scoresQuery.isFetching} empty={<Empty title="暂无评分历史" />} pagination={buildPagination(scoresQuery.data?.total ?? 0)} onRefresh={() => void scoresQuery.refetch()} refreshLoading={scoresQuery.isFetching} />
        </TabPane>
        <TabPane tab="质量异常" itemKey="anomalies">
          {commonToolbar(<Select placeholder="异常状态" showClear value={anomalyStatus} optionList={['open', 'acknowledged', 'resolved', 'ignored'].map((v) => ({ value: v, label: v }))} style={{ width: 150 }} onChange={(v) => setAnomalyStatus(v as ReportDqAnomalyStatus | undefined)} />)}
          {anomaliesQuery.isError && <Banner type="danger" description="质量异常加载失败" />}
          <ConfigurableTable bordered rowKey="id" columns={anomalyColumns} dataSource={anomaliesQuery.data?.list ?? []} loading={anomaliesQuery.isFetching} empty={<Empty title="暂无质量异常" />} pagination={buildPagination(anomaliesQuery.data?.total ?? 0)} onRefresh={() => void anomaliesQuery.refetch()} refreshLoading={anomaliesQuery.isFetching} />
        </TabPane>
        <TabPane tab="运行历史" itemKey="runs">
          {commonToolbar(
            <Select placeholder="运行状态" showClear value={runStatus} optionList={['pending', 'running', 'succeeded', 'failed', 'cancelled'].map((v) => ({ value: v, label: v }))} style={{ width: 140 }} onChange={(v) => setRunStatus(v as ReportDqRunStatus | undefined)} />,
            <ExportButton entity="report.dq-runs" query={{ datasetId: submitted.datasetId, status: submitted.runStatus }} />,
          )}
          {runsQuery.isError && <Banner type="danger" description="运行历史加载失败" />}
          <ConfigurableTable bordered rowKey="id" columns={runColumns} dataSource={runsQuery.data?.list ?? []} loading={runsQuery.isFetching} empty={<Empty title="暂无运行记录" />} pagination={buildPagination(runsQuery.data?.total ?? 0)} onRefresh={() => void runsQuery.refetch()} refreshLoading={runsQuery.isFetching} />
        </TabPane>
      </Tabs>

      <AppModal title={editing ? '编辑质量规则' : '新增质量规则'} visible={modalVisible} width={680} confirmLoading={saveMutation.isPending} onOk={() => void saveRule()} onCancel={() => setModalVisible(false)} closeOnEsc>
        <Form
          key={editing?.id ?? 'create'}
          getFormApi={(api) => { formApi.current = api; }}
          labelPosition="left"
          labelWidth={92}
          initValues={editing ? {
            ...editing,
            ...editing.config,
          } : { type: 'not_null', severity: 'medium', timezone: 'Asia/Shanghai', enabled: true }}
          onValueChange={(values) => { if (values.type) setFormRuleType(values.type as ReportDqRuleType); }}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="datasetId" label="数据集" filter style={{ width: '100%' }} optionList={datasetOptions} rules={[{ required: true, message: '请选择数据集' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="type" label="规则类型" style={{ width: '100%' }} optionList={ruleTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="severity" label="严重度" style={{ width: '100%' }} optionList={severityOptions} rules={[{ required: true }]} /></Col>
            {!['row_count', 'custom_sql'].includes(formRuleType) && <Col xs={24} md={12}><Form.Input field="field" label="校验字段" rules={[{ required: true, message: '请输入校验字段' }]} /></Col>}
            <Col xs={24} md={12}><Form.Switch field="enabled" label="启用规则" /></Col>
            <Col xs={24} md={12}><Form.Input field="cron" label="Cron" placeholder="留空仅手动执行" /></Col>
            <Col xs={24} md={12}><Form.Input field="timezone" label="时区" rules={[{ required: true }]} /></Col>
          </Row>
          <RuleConfigFields type={formRuleType} />
        </Form>
      </AppModal>

      <SideSheet title={`运行历史：${historyRule?.name ?? ''}`} visible={!!historyRule} width={720} onCancel={() => setHistoryRule(null)}>
        {historyQuery.isError && <Banner type="danger" description="规则运行历史加载失败" />}
        <ConfigurableTable bordered rowKey="id" columns={runColumns} dataSource={historyQuery.data?.list ?? []} loading={historyQuery.isFetching} empty={<Empty title="暂无运行记录" />} pagination={false} onRefresh={() => void historyQuery.refetch()} refreshLoading={historyQuery.isFetching} />
      </SideSheet>
    </div>
  );
}
