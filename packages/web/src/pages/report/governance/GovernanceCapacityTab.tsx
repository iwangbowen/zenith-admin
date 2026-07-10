import { useRef, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  DatePicker,
  Empty,
  Form,
  InputNumber,
  Modal,
  Row,
  SideSheet,
  Space,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportQueryCostLog, ReportQueryCostTrendPoint, ReportQueryQuota, ReportQuotaScope } from '@zenith/shared';
import { Plus, RotateCcw, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  useDeleteReportQueryQuota,
  useReportQueryCostLogs,
  useReportQueryCostStats,
  useReportQueryCostTrend,
  useReportQueryQuotaList,
  useReportQueryQuotaUsage,
  useResetReportQueryQuota,
  useSaveReportQueryQuota,
} from '@/hooks/queries/report-query-capacity';
import { useAllUsers } from '@/hooks/queries/users';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { validateQuotaForm } from '../report-platform-utils';

export default function GovernanceCapacityTab() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, buildPagination } = usePagination();
  const [quotaModal, setQuotaModal] = useState(false);
  const [editingQuota, setEditingQuota] = useState<ReportQueryQuota | null>(null);
  const [quotaScope, setQuotaScope] = useState<ReportQuotaScope>('tenant');
  const [usageQuota, setUsageQuota] = useState<ReportQueryQuota | null>(null);
  const [costDraft, setCostDraft] = useState({ datasetId: undefined as number | undefined, datasourceId: undefined as number | undefined, timeRange: null as [Date, Date] | null });
  const [costSearch, setCostSearch] = useState(costDraft);

  const quotasQuery = useReportQueryQuotaList({ page, pageSize });
  const usageQuery = useReportQueryQuotaUsage(usageQuota?.id, undefined, !!usageQuota);
  const costParams = {
    datasetId: costSearch.datasetId,
    datasourceId: costSearch.datasourceId,
    start: costSearch.timeRange ? formatDateTimeForApi(costSearch.timeRange[0]) : undefined,
    end: costSearch.timeRange ? formatDateTimeForApi(costSearch.timeRange[1]) : undefined,
  };
  const costsQuery = useReportQueryCostLogs({ ...costParams, page, pageSize });
  const statsQuery = useReportQueryCostStats(costParams);
  const trendQuery = useReportQueryCostTrend({ ...costParams, bucket: 'day' });
  const usersQuery = useAllUsers();
  const saveMutation = useSaveReportQueryQuota();
  const deleteMutation = useDeleteReportQueryQuota();
  const resetMutation = useResetReportQueryQuota();

  const openQuota = (record?: ReportQueryQuota) => {
    setEditingQuota(record ?? null);
    setQuotaScope(record?.scope ?? 'tenant');
    setQuotaModal(true);
  };
  const saveQuota = async () => {
    try {
      const raw = await formApi.current!.validate();
      const values = {
        ...raw,
        userId: raw.scope === 'tenant' ? null : Number(raw.userId),
        maxConcurrent: Number(raw.maxConcurrent),
        dailyQueryLimit: Number(raw.dailyQueryLimit),
        dailyRowLimit: Number(raw.dailyRowLimit),
        dailyByteLimit: Number(raw.dailyByteLimit),
        dailyCostLimit: Number(raw.dailyCostLimit),
      };
      await saveMutation.mutateAsync({ id: editingQuota?.id, values: validateQuotaForm(values, !!editingQuota) });
      Toast.success(editingQuota ? '配额已更新' : '配额已创建');
      setQuotaModal(false);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '配额保存失败');
    }
  };
  const searchCosts = () => setCostSearch(costDraft);
  const resetCosts = () => {
    const empty = { datasetId: undefined, datasourceId: undefined, timeRange: null as [Date, Date] | null };
    setCostDraft(empty);
    setCostSearch(empty);
  };

  const quotaColumns: ColumnProps<ReportQueryQuota>[] = [
    { title: '范围', dataIndex: 'scope', width: 100, render: (v, r) => v === 'tenant' ? '当前租户' : `用户 #${r.userId}` },
    { title: '并发上限', dataIndex: 'maxConcurrent', width: 110 },
    { title: '日查询', dataIndex: 'dailyQueryLimit', width: 110 },
    { title: '日行数', dataIndex: 'dailyRowLimit', width: 130 },
    { title: '日字节', dataIndex: 'dailyByteLimit', width: 140 },
    { title: '日成本', dataIndex: 'dailyCostLimit', width: 110 },
    { title: '重置时区', dataIndex: 'resetTimezone', width: 150 },
    { title: '状态', dataIndex: 'enabled', width: 90, fixed: 'right', render: (v) => <Tag color={v ? 'green' : 'grey'}>{v ? '启用' : '停用'}</Tag> },
    createOperationColumn<ReportQueryQuota>({
      width: 180,
      desktopInlineKeys: ['usage', 'edit'],
      actions: (record) => [
        { key: 'usage', label: '当前用量', onClick: () => setUsageQuota(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:query-quota:update'), onClick: () => openQuota(record) },
        {
          key: 'reset', label: '重置用量', danger: true, hidden: !hasPermission('report:query-quota:update'),
          onClick: () => { Modal.confirm({
            title: '重置当前日期的配额用量？',
            content: '该操作仅重置计量，不会取消正在运行的查询。',
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await resetMutation.mutateAsync({ id: record.id }); Toast.success('配额用量已重置'); },
          }); },
        },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:query-quota:delete'),
          onClick: () => { Modal.confirm({
            title: '删除该查询配额？',
            okButtonProps: { type: 'danger', theme: 'solid' },
            onOk: async () => { await deleteMutation.mutateAsync(record.id); Toast.success('配额已删除'); },
          }); },
        },
      ],
    }),
  ];
  const costColumns: ColumnProps<ReportQueryCostLog>[] = [
    { title: '场景', dataIndex: 'scene', width: 130 },
    { title: '用户 ID', dataIndex: 'userId', width: 100, render: (v) => v || '—' },
    { title: '数据集/源', width: 130, render: (_v, r) => r.datasetId ? `数据集 #${r.datasetId}` : r.datasourceId ? `数据源 #${r.datasourceId}` : '—' },
    { title: '排队/执行', width: 140, render: (_v, r) => `${r.queuedMs} / ${r.durationMs} ms` },
    { title: '行数', dataIndex: 'rowCount', width: 100 },
    { title: '字节', dataIndex: 'byteSize', width: 110 },
    { title: '成本', dataIndex: 'costUnits', width: 100 },
    { title: '时间', dataIndex: 'occurredAt', width: 170, render: (v) => formatDateTime(v) },
    { title: '状态', dataIndex: 'success', width: 90, fixed: 'right', render: (v) => <Tag color={v ? 'green' : 'red'}>{v ? '成功' : '失败'}</Tag> },
  ];
  const trendColumns: ColumnProps<ReportQueryCostTrendPoint>[] = [
    { title: '日期', dataIndex: 'bucket', width: 170 },
    { title: '查询数', dataIndex: 'queries', width: 100 },
    { title: '行数', dataIndex: 'rows', width: 110 },
    { title: '字节', dataIndex: 'bytes', width: 120 },
    { title: '成本', dataIndex: 'costUnits', width: 100 },
    { title: '平均耗时', dataIndex: 'avgDurationMs', width: 120, render: (v) => `${v}ms` },
    { title: '排队耗时', dataIndex: 'queueMs', width: 120, render: (v) => `${v}ms` },
  ];

  return (
    <>
      <SearchToolbar>
        {hasPermission('report:query-quota:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={() => openQuota()}>新增配额</Button> : null}
      </SearchToolbar>
      {quotasQuery.isError && <Banner type="danger" description="查询配额加载失败" />}
      <ConfigurableTable bordered rowKey="id" columns={quotaColumns} dataSource={quotasQuery.data?.list ?? []} loading={quotasQuery.isFetching} empty={<Empty title="暂无查询配额" />} pagination={buildPagination(quotasQuery.data?.total ?? 0)} onRefresh={() => void quotasQuery.refetch()} refreshLoading={quotasQuery.isFetching} />

      <Typography.Title heading={5} style={{ marginTop: 20 }}>成本与容量趋势</Typography.Title>
      <SearchToolbar>
        <InputNumber placeholder="数据集 ID" value={costDraft.datasetId} min={1} onChange={(v) => setCostDraft((p) => ({ ...p, datasetId: v ? Number(v) : undefined }))} />
        <InputNumber placeholder="数据源 ID" value={costDraft.datasourceId} min={1} onChange={(v) => setCostDraft((p) => ({ ...p, datasourceId: v ? Number(v) : undefined }))} />
        <DatePicker type="dateTimeRange" value={costDraft.timeRange ?? undefined} style={{ width: 340 }} onChange={(v) => setCostDraft((p) => ({ ...p, timeRange: v ? v as [Date, Date] : null }))} />
        <Button type="primary" icon={<Search size={14} />} onClick={searchCosts}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetCosts}>重置</Button>
        <ExportButton entity="report.query-costs" query={costParams} />
      </SearchToolbar>
      {(statsQuery.isError || trendQuery.isError || costsQuery.isError) && <Banner type="danger" description="查询成本数据加载失败" />}
      {statsQuery.data && (
        <Space spacing={24} style={{ marginBottom: 14 }}>
          <Typography.Text>查询 {statsQuery.data.queries}</Typography.Text>
          <Typography.Text>成本 {statsQuery.data.costUnits}</Typography.Text>
          <Typography.Text>平均耗时 {statsQuery.data.avgDurationMs}ms</Typography.Text>
          <Typography.Text type={statsQuery.data.failures ? 'danger' : 'success'}>失败 {statsQuery.data.failures}</Typography.Text>
          <Typography.Text>运行 {statsQuery.data.capacity.running} / {statsQuery.data.capacity.globalLimit}，排队 {statsQuery.data.capacity.queueDepth}</Typography.Text>
        </Space>
      )}
      <ConfigurableTable bordered rowKey="bucket" columns={trendColumns} dataSource={trendQuery.data ?? []} loading={trendQuery.isFetching} empty={<Empty title="暂无成本趋势" />} pagination={false} onRefresh={() => void trendQuery.refetch()} refreshLoading={trendQuery.isFetching} />
      <ConfigurableTable bordered rowKey="id" columns={costColumns} dataSource={costsQuery.data?.list ?? []} loading={costsQuery.isFetching} empty={<Empty title="暂无查询成本日志" />} pagination={buildPagination(costsQuery.data?.total ?? 0)} onRefresh={() => void costsQuery.refetch()} refreshLoading={costsQuery.isFetching} style={{ marginTop: 16 }} />

      <AppModal title={editingQuota ? '编辑查询配额' : '新增查询配额'} visible={quotaModal} width={700} confirmLoading={saveMutation.isPending} onOk={() => void saveQuota()} onCancel={() => setQuotaModal(false)} closeOnEsc>
        <Form key={editingQuota?.id ?? 'create'} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={105} initValues={editingQuota ?? { scope: 'tenant', maxConcurrent: 5, dailyQueryLimit: 1000, dailyRowLimit: 1000000, dailyByteLimit: 1073741824, dailyCostLimit: 10000, resetTimezone: 'Asia/Shanghai', enabled: true }} onValueChange={(values) => values.scope && setQuotaScope(values.scope as ReportQuotaScope)}>
          <Row gutter={16}>
            <Col xs={24} md={12}><Form.Select field="scope" label="配额范围" style={{ width: '100%' }} optionList={[{ value: 'tenant', label: '租户' }, { value: 'user', label: '用户' }]} rules={[{ required: true }]} /></Col>
            {quotaScope === 'user' && <Col xs={24} md={12}><Form.Select field="userId" label="用户" filter style={{ width: '100%' }} optionList={(usersQuery.data ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} rules={[{ required: true }]} /></Col>}
            <Col xs={24} md={12}><Form.InputNumber field="maxConcurrent" label="最大并发" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="dailyQueryLimit" label="日查询上限" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="dailyRowLimit" label="日行数上限" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="dailyByteLimit" label="日字节上限" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.InputNumber field="dailyCostLimit" label="日成本上限" min={0} style={{ width: '100%' }} rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Input field="resetTimezone" label="重置时区" rules={[{ required: true }]} /></Col>
            <Col xs={24} md={12}><Form.Switch field="enabled" label="启用配额" /></Col>
          </Row>
        </Form>
      </AppModal>

      <SideSheet title="当前查询配额用量" visible={!!usageQuota} width={520} onCancel={() => setUsageQuota(null)}>
        {usageQuery.isError && <Banner type="danger" description="配额用量加载失败" />}
        {usageQuery.data && (
          <Space vertical align="start">
            <Typography.Title heading={5}>{usageQuery.data.day} · {usageQuery.data.timezone}</Typography.Title>
            <Typography.Text>并发：{usageQuery.data.concurrent} / {usageQuery.data.maxConcurrent}</Typography.Text>
            <Typography.Text>查询：{usageQuery.data.queries} / {usageQuery.data.dailyQueryLimit}</Typography.Text>
            <Typography.Text>行数：{usageQuery.data.rows} / {usageQuery.data.dailyRowLimit}</Typography.Text>
            <Typography.Text>字节：{usageQuery.data.bytes} / {usageQuery.data.dailyByteLimit}</Typography.Text>
            <Typography.Text>成本：{usageQuery.data.costUnits} / {usageQuery.data.dailyCostLimit}</Typography.Text>
          </Space>
        )}
      </SideSheet>
    </>
  );
}
