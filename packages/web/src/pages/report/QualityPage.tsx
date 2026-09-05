import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Col, Empty, Form, Modal, Row, SideSheet, Space, Switch, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportDqAnomaly, ReportDqAnomalyStatus, ReportDqRule, ReportDqRuleType, ReportDqRun, ReportDqRunStatus, ReportDqScore } from '@zenith/shared/report';
import { MetricMeter } from '@/components/data-viz/MetricMeter';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import ExportButton from '@/components/ExportButton';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
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
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { DEFAULT_TIMEZONE } from '@/utils/timezones';
import { REPORT_DQ_ANOMALY_STATUS_LABELS, REPORT_DQ_ANOMALY_STATUS_OPTIONS, REPORT_DQ_TRIGGER_LABELS } from '@zenith/shared/report';
import {
  dqRunStatusLabel,
  dqTaskSubmissionMessage,
  formatDqPassRate,
  normalizeDqRuleFormValues,
} from './report-platform-utils';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { FilterSelect } from '@/components/search-filters';
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
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [activeTab, setActiveTab] = useUrlTabState(['rules', 'scores', 'anomalies', 'runs'] as const, 'rules');
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
  const [formRuleType, setFormRuleType] = useState<ReportDqRuleType>('not_null');
  const [cronExprValue, setCronExprValue] = useState('');
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

  const ruleModal = useEditModal<ReportDqRule, Record<string, unknown>>({
    entityName: '质量规则',
    save: saveMutation,
    defaults: { type: 'not_null', severity: 'medium', timezone: DEFAULT_TIMEZONE, enabled: true },
    labelWidth: 110,
    toValues: (record) => ({
      ...record,
      ...record.config,
    }),
    beforeSave: (values, { isEdit }) => normalizeDqRuleFormValues(values, isEdit),
    successMessage: ({ isEdit }) => isEdit ? '质量规则已更新' : '质量规则已创建',
  });
  const openCreate = () => {
    setFormRuleType('not_null');
    setCronExprValue('');
    ruleModal.openCreate();
  };
  const openEdit = (record: ReportDqRule) => {
    setFormRuleType(record.type);
    setCronExprValue(record.cron ?? '');
    ruleModal.openEdit(record);
  };
  const runRule = async (record: ReportDqRule) => {
    try {
      const task = await runMutation.mutateAsync({ params: { id: record.id }, body: { sampleLimit: 20 } });
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
        await anomalyMutation.mutateAsync({ params: { id: record.id }, body: { status } });
        Toast.success(status === 'acknowledged' ? '异常已确认' : '异常已解决');
      },
    });
  };

  const ruleColumns: ColumnProps<ReportDqRule>[] = [
    { title: '规则名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 120, render: (v) => ruleTypeOptions.find((item) => item.value === v)?.label ?? v },
    { title: '字段', dataIndex: 'field', width: 120, render: renderEllipsis },
    { title: '严重度', dataIndex: 'severity', width: 90, render: (v: ReportDqRule['severity']) => <Tag color={severityColor[v]}>{severityOptions.find((i) => i.value === v)?.label}</Tag> },
    { title: 'Cron', dataIndex: 'cron', width: 160, render: (v) => renderEllipsis(v || '仅手动') },
    { title: '时区', dataIndex: 'timezone', width: 150, render: renderEllipsis },
    dateTimeColumn('最近运行', 'lastRunAt'),
    {
      title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right',
      render: (v: boolean, r) => <Switch size="small" checked={v} disabled={!hasPermission('report:dq:update')} loading={toggleMutation.isPending && toggleMutation.variables?.params.id === r.id} onChange={() => toggleMutation.mutate({ params: { id: r.id } })} />,
    },
    createOperationColumn<ReportDqRule>({
      width: 180,
      desktopInlineKeys: ['run', 'edit'],
      actions: (record) => [
        { key: 'run', label: '执行', hidden: !hasPermission('report:dq:run'), loading: runMutation.isPending && runMutation.variables?.params.id === record.id, onClick: () => void runRule(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:dq:update'), onClick: () => openEdit(record) },
        { key: 'history', label: '运行历史', onClick: () => setHistoryRule(record) },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:dq:delete'),
          onClick: () => { confirmDelete({
            title: `删除规则「${record.name}」？`,
            onOk: async () => { await deleteMutation.mutateAsync({ params: { id: record.id } }); Toast.success('规则已删除'); },
          }); },
        },
      ],
    }),
  ];
  const runColumns: ColumnProps<ReportDqRun>[] = [
    { title: '规则', dataIndex: 'ruleId', minWidth: 150, render: (v: number, r) => renderEllipsis(r.ruleName || `#${v}`) },
    { title: '数据集', dataIndex: 'datasetId', width: 150, render: (v: number, r) => renderEllipsis(r.datasetName || `#${v}`) },
    { title: '触发方式', dataIndex: 'triggerType', width: 110, render: (v: ReportDqRun['triggerType']) => REPORT_DQ_TRIGGER_LABELS[v] ?? v },
    { title: '检查/失败行', width: 140, render: (_v, r) => `${r.checkedRows} / ${r.failedRows}` },
    { title: '通过率', dataIndex: 'passRate', width: 110, align: 'right', render: (v) => formatDqPassRate(v) },
    { title: '耗时', dataIndex: 'durationMs', width: 100, align: 'right', render: (v) => v == null ? '—' : `${v}ms` },
    dateTimeColumn('开始时间', 'startedAt'),
    { title: '状态', dataIndex: 'status', width: 100, fixed: 'right', render: (v: ReportDqRunStatus) => <Tag color={runStatusColor[v]}>{dqRunStatusLabel(v)}</Tag> },
  ];
  const anomalyColumns: ColumnProps<ReportDqAnomaly>[] = [
    { title: '异常', dataIndex: 'title', minWidth: 230, render: renderEllipsis },
    { title: '数据集', dataIndex: 'datasetId', width: 150, render: (v: number, r) => renderEllipsis(r.datasetName || `#${v}`) },
    { title: '规则', dataIndex: 'ruleId', width: 150, render: (v: number | null, r) => renderEllipsis(v ? r.ruleName || `#${v}` : null) },
    { title: '严重度', dataIndex: 'severity', width: 90, render: (v: ReportDqAnomaly['severity']) => <Tag color={severityColor[v]}>{severityOptions.find((item) => item.value === v)?.label ?? v}</Tag> },
    { title: '详情', dataIndex: 'detail', width: 260, render: renderEllipsis },
    dateTimeColumn('发现时间', 'createdAt'),
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: ReportDqAnomalyStatus) => <Tag>{REPORT_DQ_ANOMALY_STATUS_LABELS[v] ?? v}</Tag> },
    createOperationColumn<ReportDqAnomaly>({
      width: 150,
      actions: (record) => [
        { key: 'ack', label: '确认', hidden: !hasPermission('report:dq:update') || record.status !== 'open', onClick: () => updateAnomaly(record, 'acknowledged') },
        { key: 'resolve', label: '解决', hidden: !hasPermission('report:dq:update') || !['open', 'acknowledged'].includes(record.status), onClick: () => updateAnomaly(record, 'resolved') },
      ],
    }),
  ];
  const scoreColumns: ColumnProps<ReportDqScore>[] = [
    { title: '评分', dataIndex: 'score', width: 160, render: (v) => {
      const score = Number(v);
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ minWidth: 28 }}>{score}</span>
          <MetricMeter value={score} label="数据质量评分" valueText={`${score} 分`} tone={score >= 80 ? 'success' : score >= 60 ? 'warning' : 'danger'} style={{ flex: 1 }} />
        </div>
      );
    } },
    { title: '规则总数', dataIndex: 'totalRules', width: 100, align: 'right' },
    { title: '通过', dataIndex: 'passedRules', width: 90 },
    { title: '失败', dataIndex: 'failedRules', width: 90 },
    { title: '维度明细', dataIndex: 'dimensions', width: 260, render: (v: Record<string, number> | null) => {
      if (!v || Object.keys(v).length === 0) return '—';
      return (
        <Space spacing={4} wrap>
          {severityOptions.filter((item) => v[item.value] !== undefined).map((item) => (
            <Tag key={item.value} size="small" color={severityColor[item.value as keyof typeof severityColor]}>
              {item.label} {v[item.value]}
            </Tag>
          ))}
        </Space>
      );
    } },
    dateTimeColumn('测量时间', 'measuredAt'),
  ];

  const datasetFilter = (
    <FilterSelect
      placeholder="全部数据集"
      items={datasetOptions}
      value={datasetId}
      onChange={(v) => {
        const next = v as number | undefined;
        setDatasetId(next);
        // 评分 Tab 选中数据集即自动查询，无需再点「查询」
        if (activeTab === 'scores') {
          setPage(1);
          setSubmitted((prev) => ({ ...prev, datasetId: next }));
        }
      }}
      width={190}
      filter
    />
  );
  const searchButtons = <><SearchButton onClick={applySearch} /><ResetButton onClick={resetSearch} /></>;
  const commonToolbar = (extraFilters?: React.ReactNode, actions?: React.ReactNode) => (
    <SearchToolbar
      primary={<>{datasetFilter}{searchButtons}</>}
      filters={extraFilters}
      actions={actions}
      mobilePrimary={<>{datasetFilter}<SearchButton onClick={applySearch} />{actions}</>}
      onFilterApply={applySearch}
      onFilterReset={resetSearch}
    />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(key) => { setActiveTab(key as typeof activeTab); setPage(1); }}>
        <TabPane tab="质量规则" itemKey="rules">
          {commonToolbar(
            <>
              <FilterSelect
                placeholder="全部规则类型"
                items={ruleTypeOptions}
                value={ruleType}
                onChange={(v) => setRuleType(v as ReportDqRuleType | undefined)}
                width={140}
              />
              <FilterSelect
                placeholder="全部启用状态"
                items={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]}
                value={enabled === undefined ? undefined : String(enabled)}
                onChange={(v) => setEnabled(v == null ? undefined : v === 'true')}
                width={140}
              />
            </>,
            hasPermission('report:dq:create') ? <CreateButton onClick={openCreate} /> : null,
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
          {commonToolbar(<FilterSelect
            placeholder="全部异常状态"
            items={REPORT_DQ_ANOMALY_STATUS_OPTIONS}
            value={anomalyStatus}
            onChange={(v) => setAnomalyStatus(v as ReportDqAnomalyStatus | undefined)}
            width={150}
          />)}
          {anomaliesQuery.isError && <Banner type="danger" description="质量异常加载失败" />}
          <ConfigurableTable bordered rowKey="id" columns={anomalyColumns} dataSource={anomaliesQuery.data?.list ?? []} loading={anomaliesQuery.isFetching} empty={<Empty title="暂无质量异常" />} pagination={buildPagination(anomaliesQuery.data?.total ?? 0)} onRefresh={() => void anomaliesQuery.refetch()} refreshLoading={anomaliesQuery.isFetching} />
        </TabPane>
        <TabPane tab="运行历史" itemKey="runs">
          {commonToolbar(
            <FilterSelect
              placeholder="全部运行状态"
              items={['pending', 'running', 'succeeded', 'failed', 'cancelled'].map((v) => ({ value: v, label: dqRunStatusLabel(v as ReportDqRunStatus) }))}
              value={runStatus}
              onChange={(v) => setRunStatus(v as ReportDqRunStatus | undefined)}
              width={140}
            />,
            <ExportButton entity="report.dq-runs" query={{ datasetId: submitted.datasetId, status: submitted.runStatus }} />,
          )}
          {runsQuery.isError && <Banner type="danger" description="运行历史加载失败" />}
          <ConfigurableTable bordered rowKey="id" columns={runColumns} dataSource={runsQuery.data?.list ?? []} loading={runsQuery.isFetching} empty={<Empty title="暂无运行记录" />} pagination={buildPagination(runsQuery.data?.total ?? 0)} onRefresh={() => void runsQuery.refetch()} refreshLoading={runsQuery.isFetching} />
        </TabPane>
      </Tabs>

      <AppModal {...ruleModal.modalProps} width={680}>
        <Form
          key={ruleModal.formKey} {...ruleModal.formProps}
          onValueChange={(values: Record<string, unknown>) => {
            if (values.type) setFormRuleType(values.type as ReportDqRuleType);
            if (typeof values.cron === 'string') setCronExprValue(values.cron);
          }}
        >
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="datasetId" label="数据集" filter style={{ width: '100%' }} optionList={datasetOptions} rules={[{ required: true, message: '请选择数据集' }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="type" label="规则类型" style={{ width: '100%' }} optionList={ruleTypeOptions} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Select field="severity" label="严重度" style={{ width: '100%' }} optionList={severityOptions} rules={[{ required: true }]} /></Col>
            {!['row_count', 'custom_sql'].includes(formRuleType) && <Col xs={24} md={12}><Form.Input field="field" label="校验字段" rules={[{ required: true, message: '请输入校验字段' }]} /></Col>}
            <Col xs={24} md={12}><Form.Switch field="enabled" label="启用规则" /></Col>
            <Col xs={24} md={12}>
              <Form.Input
                field="cron"
                label="Cron 表达式"
                placeholder="留空仅手动执行"
                showClear
                addonAfter={(
                  <CronBuilderPopover
                    value={cronExprValue}
                    onApply={(expression) => {
                      ruleModal.formApi.current?.setValue('cron', expression);
                      setCronExprValue(expression);
                    }}
                  />
                )}
              />
            </Col>
            <Col xs={24} md={12}>
              <FormTimezoneSelect />
            </Col>
          </Row>
          <RuleConfigFields type={formRuleType} />
        </Form>
      </AppModal>

      <SideSheet title={`运行历史：${historyRule?.name ?? ''}`} visible={!!historyRule} width={980} onCancel={() => setHistoryRule(null)}>
        {historyQuery.isError && <Banner type="danger" description="规则运行历史加载失败" />}
        <ConfigurableTable bordered rowKey="id" columns={runColumns} dataSource={historyQuery.data?.list ?? []} loading={historyQuery.isFetching} empty={<Empty title="暂无运行记录" />} pagination={false} onRefresh={() => void historyQuery.refetch()} refreshLoading={historyQuery.isFetching} />
      </SideSheet>
    </div>
  );
}
