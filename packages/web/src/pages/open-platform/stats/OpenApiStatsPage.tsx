import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, DatePicker, Select, Typography, Tag, Space, Row, Col, Card } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw } from 'lucide-react';
import dayjs from 'dayjs';
import type {
  OpenApiStatsOverview,
  OpenApiStatsTrendPoint,
  OpenApiStatsGroupItem,
  OpenApiCallLog,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePagination } from '@/hooks/usePagination';
import { AreaChart, BarChart, chartOptions, makeAreaSpec, makeBarSpec, useChartPalette, EmptyChart } from '@/components/charts';

const { Text, Title } = Typography;

function StatCard({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 150 }} bodyStyle={{ padding: 16 }}>
      <Text type="tertiary" size="small">{label}</Text>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color }}>{value}</div>
      {hint && <Text type="tertiary" size="small">{hint}</Text>}
    </Card>
  );
}

export default function OpenApiStatsPage() {
  const palette = useChartPalette();
  const [range, setRange] = useState<[Date, Date]>(() => [dayjs().subtract(6, 'day').toDate(), new Date()]);
  const [granularity, setGranularity] = useState<'hour' | 'day'>('day');

  const [overview, setOverview] = useState<OpenApiStatsOverview | null>(null);
  const [trend, setTrend] = useState<OpenApiStatsTrendPoint[]>([]);
  const [byApp, setByApp] = useState<OpenApiStatsGroupItem[]>([]);
  const [byEndpoint, setByEndpoint] = useState<OpenApiStatsGroupItem[]>([]);
  const [statLoading, setStatLoading] = useState(false);

  const [logs, setLogs] = useState<PaginatedResponse<OpenApiCallLog> | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const rangeParams = useCallback(() => ({
    startTime: dayjs(range[0]).startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    endTime: dayjs(range[1]).endOf('day').format('YYYY-MM-DD HH:mm:ss'),
  }), [range]);

  const fetchStats = useCallback(async () => {
    setStatLoading(true);
    try {
      const { startTime, endTime } = rangeParams();
      const base = `startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`;
      const [ov, tr, ba, be] = await Promise.all([
        request.get<OpenApiStatsOverview>(`/api/open-api-stats/overview?${base}`, { silent: true }),
        request.get<OpenApiStatsTrendPoint[]>(`/api/open-api-stats/trend?${base}&granularity=${granularity}`, { silent: true }),
        request.get<OpenApiStatsGroupItem[]>(`/api/open-api-stats/by-app?${base}&limit=8`, { silent: true }),
        request.get<OpenApiStatsGroupItem[]>(`/api/open-api-stats/by-endpoint?${base}&limit=8`, { silent: true }),
      ]);
      if (ov.code === 0) setOverview(ov.data);
      if (tr.code === 0) setTrend(tr.data ?? []);
      if (ba.code === 0) setByApp(ba.data ?? []);
      if (be.code === 0) setByEndpoint(be.data ?? []);
    } finally {
      setStatLoading(false);
    }
  }, [rangeParams, granularity]);

  const fetchLogs = useCallback(async (p = page, ps = pageSize) => {
    setLogLoading(true);
    try {
      const { startTime, endTime } = rangeParams();
      const q = new URLSearchParams({ page: String(p), pageSize: String(ps), startTime, endTime });
      const res = await request.get<PaginatedResponse<OpenApiCallLog>>(`/api/open-api-stats/logs?${q}`);
      if (res.code === 0) {
        setLogs(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLogLoading(false);
    }
  }, [page, pageSize, rangeParams, setPage]);

  useEffect(() => {
    void fetchStats();
    void fetchLogs(1, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApply() {
    void fetchStats();
    void fetchLogs(1, pageSize);
    setPage(1);
  }
  function handleReset() {
    setRange([dayjs().subtract(6, 'day').toDate(), new Date()]);
    setGranularity('day');
  }

  const trendSpec = useMemo(() => makeAreaSpec({
    data: trend,
    xField: 'time',
    series: [
      { field: 'success', name: '成功', color: '#16a34a' },
      { field: 'failed', name: '失败', color: '#dc2626' },
    ],
    palette,
    stack: true,
  }), [trend, palette]);

  const appSpec = useMemo(() => makeBarSpec({
    data: byApp,
    xField: 'label',
    series: [{ field: 'total', name: '调用次数', color: '#3b82f6' }],
    palette,
    horizontal: true,
    showLabel: true,
    categoryAxisWidth: 110,
  }), [byApp, palette]);

  const endpointSpec = useMemo(() => makeBarSpec({
    data: byEndpoint,
    xField: 'label',
    series: [{ field: 'total', name: '调用次数', color: '#8b5cf6' }],
    palette,
    horizontal: true,
    showLabel: true,
    categoryAxisWidth: 160,
  }), [byEndpoint, palette]);

  const logColumns: ColumnProps<OpenApiCallLog>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 160 },
    {
      title: '应用',
      dataIndex: 'appName',
      width: 180,
      render: (v: string | null, r: OpenApiCallLog) => (
        <div>
          <div>{v || <Text type="tertiary">未知</Text>}</div>
          <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{r.clientId}</Text>
        </div>
      ),
    },
    {
      title: '请求',
      dataIndex: 'path',
      render: (v: string, r: OpenApiCallLog) => (
        <Space spacing={6}>
          <Tag size="small" color="grey">{r.method}</Tag>
          <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 280 }}>{v}</Text>
        </Space>
      ),
    },
    { title: 'Scope', dataIndex: 'scope', width: 120, render: (v: string | null) => v ? <Tag size="small" color="blue">{v}</Tag> : <Text type="tertiary">—</Text> },
    { title: '耗时', dataIndex: 'durationMs', width: 90, render: (v: number) => `${v} ms` },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || '—' },
    {
      title: '状态',
      dataIndex: 'statusCode',
      width: 90,
      fixed: 'right' as const,
      render: (v: number, r: OpenApiCallLog) => <Tag size="small" color={r.success ? 'green' : 'red'}>{v}</Tag>,
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <DatePicker
              type="dateRange"
              value={range}
              onChange={(v) => { if (Array.isArray(v) && v.length === 2) setRange([v[0] as Date, v[1] as Date]); }}
              density="compact"
              style={{ width: 256 }}
            />
            <Select
              value={granularity}
              onChange={(v) => setGranularity(v as 'hour' | 'day')}
              optionList={[{ value: 'day', label: '按天' }, { value: 'hour', label: '按小时' }]}
              style={{ width: 110 }}
            />
            <Button type="primary" onClick={handleApply}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
      />

      <Space style={{ width: '100%', marginBottom: 16 }} wrap>
        <StatCard label="调用总数" value={(overview?.totalCalls ?? 0).toLocaleString()} hint={`今日 ${overview?.todayCalls ?? 0}`} />
        <StatCard label="成功率" value={`${overview?.successRate ?? 0}%`} color="#16a34a" hint={`成功 ${overview?.successCalls ?? 0}`} />
        <StatCard label="失败数" value={(overview?.failedCalls ?? 0).toLocaleString()} color="#dc2626" />
        <StatCard label="平均耗时" value={`${overview?.avgDurationMs ?? 0} ms`} />
        <StatCard label="活跃应用" value={overview?.activeApps ?? 0} />
      </Space>

      <Card style={{ marginBottom: 16 }} title={<Title heading={6} style={{ margin: 0 }}>调用趋势</Title>} loading={statLoading}>
        {trend.length ? <AreaChart {...trendSpec} options={chartOptions} height={280} /> : <EmptyChart height={280} />}
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>应用调用 Top</Title>} loading={statLoading}>
            {byApp.length ? <BarChart {...appSpec} options={chartOptions} height={300} /> : <EmptyChart height={300} />}
          </Card>
        </Col>
        <Col span={12}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>端点调用 Top</Title>} loading={statLoading}>
            {byEndpoint.length ? <BarChart {...endpointSpec} options={chartOptions} height={300} /> : <EmptyChart height={300} />}
          </Card>
        </Col>
      </Row>

      <Card title={<Title heading={6} style={{ margin: 0 }}>调用日志</Title>}>
        <ConfigurableTable
          bordered
          columns={logColumns}
          dataSource={logs?.list ?? []}
          loading={logLoading}
          onRefresh={() => fetchLogs()}
          refreshLoading={logLoading}
          rowKey="id"
          size="small"
          empty="暂无调用记录"
          pagination={buildPagination(logs?.total ?? 0, fetchLogs)}
        />
      </Card>
    </div>
  );
}
