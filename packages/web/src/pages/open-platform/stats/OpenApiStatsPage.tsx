import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, InputNumber, Select, Typography, Tag, Space, Row, Col, Card } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import dayjs from 'dayjs';
import type {
  OpenApiCallLog,
} from '@zenith/shared';
import { OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_ENVIRONMENTS } from '@zenith/shared';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ExportButton } from '@/components/ExportButton';
import { usePagination } from '@/hooks/usePagination';
import { AreaChart, BarChart, chartOptions, makeAreaSpec, makeBarSpec, useChartPalette, EmptyChart } from '@/components/charts';
import {
  openPlatformKeys,
  useOpenApiCallLogs,
  useOpenApiStatsByApp,
  useOpenApiStatsByEndpoint,
  useOpenApiStatsOverview,
  useOpenApiStatsTrend,
  useOpenAppOptions,
} from '@/hooks/queries/open-platform';

const { Text, Title } = Typography;

function StatCard({ label, value, hint, color }: { label: string; value: string | number; hint?: string; color?: string }) {
  return (
    <Card style={{ flex: '1 1 150px', minWidth: 150 }} bodyStyle={{ padding: 16 }}>
      <Text type="tertiary" size="small">{label}</Text>
      <div style={{ fontSize: 26, fontWeight: 600, margin: '4px 0 2px', color }}>{value}</div>
      <Text type="tertiary" size="small">{hint ?? '\u00A0'}</Text>
    </Card>
  );
}

export default function OpenApiStatsPage() {
  const palette = useChartPalette();
  const queryClient = useQueryClient();
  interface SearchParams {
    range: [Date, Date];
    granularity: 'hour' | 'day';
    keyword: string;
    clientId?: string;
    method?: string;
    success?: boolean;
    statusCode?: number;
    environment?: OpenApiCallLog['environment'];
  }
  const createDefaultParams = (): SearchParams => ({
    range: [dayjs().subtract(6, 'day').toDate(), new Date()],
    granularity: 'day',
    keyword: '',
  });
  const [draftParams, setDraftParams] = useState<SearchParams>(createDefaultParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(createDefaultParams);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const appOptions = useOpenAppOptions().data ?? [];

  const rangeParams = useMemo(() => ({
    startTime: dayjs(submittedParams.range[0]).startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    endTime: dayjs(submittedParams.range[1]).endOf('day').format('YYYY-MM-DD HH:mm:ss'),
    clientId: submittedParams.clientId,
    environment: submittedParams.environment,
  }), [submittedParams]);
  const overviewQuery = useOpenApiStatsOverview(rangeParams);
  const trendQuery = useOpenApiStatsTrend({ ...rangeParams, granularity: submittedParams.granularity });
  const byAppQuery = useOpenApiStatsByApp(rangeParams);
  const byEndpointQuery = useOpenApiStatsByEndpoint(rangeParams);
  const logParams = {
    ...rangeParams,
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    method: submittedParams.method,
    success: submittedParams.success,
    statusCode: submittedParams.statusCode,
  };
  const logsQuery = useOpenApiCallLogs(logParams);
  const overview = overviewQuery.data ?? null;
  const trend = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const byApp = useMemo(() => byAppQuery.data ?? [], [byAppQuery.data]);
  const byEndpoint = useMemo(() => byEndpointQuery.data ?? [], [byEndpointQuery.data]);
  const logs = logsQuery.data ?? null;
  const statLoading = overviewQuery.isFetching || trendQuery.isFetching || byAppQuery.isFetching || byEndpointQuery.isFetching;

  function handleApply() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: openPlatformKeys.stats.all });
  }
  function handleReset() {
    const defaults = createDefaultParams();
    setDraftParams(defaults);
    setSubmittedParams(defaults);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: openPlatformKeys.stats.all });
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
      title: '环境',
      dataIndex: 'environment',
      width: 90,
      render: (value: OpenApiCallLog['environment']) => (
        <Tag size="small" color={value === 'sandbox' ? 'orange' : 'blue'}>{OPEN_APP_ENVIRONMENT_LABELS[value]}</Tag>
      ),
    },
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
              value={draftParams.range}
              onChange={(v) => {
                if (Array.isArray(v) && v.length === 2) {
                  setDraftParams({ ...draftParams, range: [v[0] as Date, v[1] as Date] });
                }
              }}
              density="compact"
              style={{ width: 256 }}
            />
            <Select
              value={draftParams.granularity}
              onChange={(v) => setDraftParams({ ...draftParams, granularity: v as 'hour' | 'day' })}
              optionList={[{ value: 'day', label: '按天' }, { value: 'hour', label: '按小时' }]}
              style={{ width: 110 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleApply}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </>
        )}
        filters={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="路径 / 应用名称"
              value={draftParams.keyword}
              onChange={(keyword) => setDraftParams({ ...draftParams, keyword })}
              onEnterPress={handleApply}
              showClear
              style={{ width: 190 }}
            />
            <Select
              placeholder="应用"
              value={draftParams.clientId}
              onChange={(clientId) => setDraftParams({ ...draftParams, clientId: clientId as string })}
              optionList={appOptions.map((app) => ({ value: app.clientId, label: app.name }))}
              showClear
              filter
              style={{ width: 170 }}
            />
            <Select
              placeholder="环境"
              value={draftParams.environment}
              onChange={(environment) => setDraftParams({ ...draftParams, environment: environment as OpenApiCallLog['environment'] })}
              optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              showClear
              style={{ width: 110 }}
            />
            <Select
              placeholder="请求方法"
              value={draftParams.method}
              onChange={(method) => setDraftParams({ ...draftParams, method: method as string })}
              optionList={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))}
              showClear
              style={{ width: 120 }}
            />
            <Select
              placeholder="调用结果"
              value={draftParams.success === undefined ? undefined : String(draftParams.success)}
              onChange={(success) => setDraftParams({
                ...draftParams,
                success: success === undefined ? undefined : success === 'true',
              })}
              optionList={[{ value: 'true', label: '成功' }, { value: 'false', label: '失败' }]}
              showClear
              style={{ width: 110 }}
            />
            <InputNumber
              placeholder="状态码"
              value={draftParams.statusCode}
              onChange={(statusCode) => setDraftParams({ ...draftParams, statusCode: typeof statusCode === 'number' ? statusCode : undefined })}
              min={100}
              max={599}
              style={{ width: 110 }}
            />
          </>
        )}
        actions={<ExportButton entity="open-platform.call-logs" query={logParams} executionMode="auto" />}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索调用日志"
              value={draftParams.keyword}
              onChange={(keyword) => setDraftParams({ ...draftParams, keyword })}
              onEnterPress={handleApply}
              showClear
              style={{ width: 190 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleApply}>查询</Button>
          </>
        )}
        mobileFilters={(
          <>
            <DatePicker
              type="dateRange"
              value={draftParams.range}
              onChange={(v) => {
                if (Array.isArray(v) && v.length === 2) {
                  setDraftParams({ ...draftParams, range: [v[0] as Date, v[1] as Date] });
                }
              }}
              style={{ width: '100%' }}
            />
            <Select
              placeholder="应用"
              value={draftParams.clientId}
              onChange={(clientId) => setDraftParams({ ...draftParams, clientId: clientId as string })}
              optionList={appOptions.map((app) => ({ value: app.clientId, label: app.name }))}
              showClear
              filter
              style={{ width: '100%' }}
            />
            <Select
              placeholder="环境"
              value={draftParams.environment}
              onChange={(environment) => setDraftParams({ ...draftParams, environment: environment as OpenApiCallLog['environment'] })}
              optionList={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              showClear
              style={{ width: '100%' }}
            />
          </>
        )}
        mobileActions={<ExportButton entity="open-platform.call-logs" query={logParams} executionMode="auto" variant="flat" />}
        actionTitle="统计操作"
      />

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatCard label="调用总数" value={(overview?.totalCalls ?? 0).toLocaleString()} hint={`今日 ${overview?.todayCalls ?? 0}`} />
        <StatCard label="成功率" value={`${overview?.successRate ?? 0}%`} color="#16a34a" hint={`成功 ${overview?.successCalls ?? 0}`} />
        <StatCard label="失败数" value={(overview?.failedCalls ?? 0).toLocaleString()} color="#dc2626" />
        <StatCard label="平均耗时" value={`${overview?.avgDurationMs ?? 0} ms`} />
        <StatCard
          label="P95 耗时"
          value={`${overview?.p95DurationMs ?? 0} ms`}
          hint={overview?.percentilesPartial ? `仅基于近 ${overview.percentileRetentionDays} 天原始日志` : '95% 请求低于该值'}
        />
        <StatCard
          label="P99 耗时"
          value={`${overview?.p99DurationMs ?? 0} ms`}
          hint={overview?.percentilesPartial ? `仅基于近 ${overview.percentileRetentionDays} 天原始日志` : '99% 请求低于该值'}
        />
        <StatCard label="活跃应用" value={overview?.activeApps ?? 0} />
      </div>

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
          loading={logsQuery.isFetching}
          onRefresh={() => void logsQuery.refetch()}
          refreshLoading={logsQuery.isFetching}
          rowKey="id"
          size="small"
          empty="暂无调用记录"
          pagination={buildPagination(logs?.total ?? 0)}
        />
      </Card>
    </div>
  );
}
