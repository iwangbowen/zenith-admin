import { useMemo } from 'react';
import { listTableProps } from '@/components/list-page';
import { Banner, InputNumber, Select, Typography, Tag, Tooltip, Space, Card } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import dayjs from 'dayjs';
import type { OpenApiCallLog } from '@zenith/shared/open-platform';
import { OPEN_APP_ENVIRONMENT_LABELS, OPEN_APP_ENVIRONMENTS } from '@zenith/shared/open-platform';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { ExportButton } from '@/components/ExportButton';
import { useListSearch } from '@/hooks/useListSearch';
import { AreaChart, BarChart, chartOptions, makeAreaSpec, makeBarSpec, useChartPalette, EmptyChart, StatCard, StatGrid } from '@/components/charts';
import {
  openApiStatsKeys,
  useOpenApiCallLogs,
  useOpenApiStatsByApp,
  useOpenApiStatsByEndpoint,
  useOpenApiStatsOverview,
  useOpenApiStatsTrend,
  useOpenAppOptions,
} from '@/hooks/queries/open-platform';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';

const { Text, Title } = Typography;

export default function OpenApiStatsPage() {
  const palette = useChartPalette();
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
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch: handleApply, handleReset,
  } = useListSearch<SearchParams>({ defaults: createDefaultParams, listKey: openApiStatsKeys.all });
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
  // 明细筛选只作用于日志表，KPI/图表走预聚合表，口径差异需向用户显式说明
  const hasDetailFilters = Boolean(
    submittedParams.keyword
    || submittedParams.method
    || submittedParams.success !== undefined
    || submittedParams.statusCode !== undefined,
  );
  const overview = overviewQuery.data ?? null;
  const trend = useMemo(() => trendQuery.data ?? [], [trendQuery.data]);
  const byApp = useMemo(() => byAppQuery.data ?? [], [byAppQuery.data]);
  const byEndpoint = useMemo(() => byEndpointQuery.data ?? [], [byEndpointQuery.data]);
  const statLoading = overviewQuery.isFetching || trendQuery.isFetching || byAppQuery.isFetching || byEndpointQuery.isFetching;

  const trendSpec = useMemo(() => makeAreaSpec({
    data: trend,
    xField: 'time',
    series: [
      { field: 'success', name: '成功', color: '#16a34a' },
      { field: 'failed', name: '失败', color: '#dc2626' },
    ],
    palette,
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
    dateTimeColumn('时间', 'createdAt'),
    {
      title: '应用',
      dataIndex: 'appName',
      width: 180,
      render: (v: string | null, r: OpenApiCallLog) => (
        <Tooltip content={`Client ID: ${r.clientId ?? '—'}`}>
          <Text ellipsis style={{ maxWidth: 165 }}>{v || '未知'}</Text>
        </Tooltip>
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
    {
      title: '鉴权通道',
      dataIndex: 'authChannel',
      width: 110,
      render: (v: OpenApiCallLog['authChannel']) => (
        v === 'bearer' ? <Tag size="small" color="green">Bearer</Tag>
          : v === 'signature' ? <Tag size="small" color="purple">HMAC 签名</Tag>
            : <Text type="tertiary">—</Text>
      ),
    },
    { title: '耗时', dataIndex: 'durationMs', width: 90, align: 'right', render: (v: number) => `${v} ms` },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v || '—' },
    {
      title: '环境',
      dataIndex: 'environment',
      width: 100,
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
    <div className="page-container zx-flat-panels">
      <SearchToolbar
        primary={(
          <>
            <DateRangeFilter
              type="dateRange"
              value={draftParams.range}
              onChange={(range) => {
                if (range) setField('range')(range);
              }}
              density="compact"
            />
            <Select
              value={draftParams.granularity}
              onChange={(v) => setField('granularity')(v as 'hour' | 'day')}
              optionList={[{ value: 'day', label: '按天' }, { value: 'hour', label: '按小时' }]}
              style={{ width: 110 }}
            />
            <SearchButton onClick={handleApply} />
            <ResetButton onClick={handleReset} />
          </>
        )}
        filters={(
          <>
            <KeywordInput placeholder="路径 / 应用名称" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleApply} width={190} />
            <FilterSelect
              placeholder="全部应用"
              items={appOptions.map((app) => ({ value: app.clientId, label: app.name }))}
              value={draftParams.clientId}
              onChange={(clientId) => setField('clientId')(clientId as string)}
              width={170}
              filter
            />
            <FilterSelect
              placeholder="全部环境"
              items={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              value={draftParams.environment}
              onChange={(environment) => setField('environment')(environment as OpenApiCallLog['environment'])}
            />
            <FilterSelect
              placeholder="全部请求方法"
              items={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }))}
              value={draftParams.method}
              onChange={(method) => setField('method')(method as string)}
              width={140}
            />
            <FilterSelect
              placeholder="全部调用结果"
              items={[{ value: 'true', label: '成功' }, { value: 'false', label: '失败' }]}
              value={draftParams.success === undefined ? undefined : String(draftParams.success)}
              onChange={(success) => setField('success')(success === undefined ? undefined : success === 'true')}
              width={140}
            />
            <InputNumber
              placeholder="状态码"
              value={draftParams.statusCode}
              onChange={(statusCode) => setField('statusCode')(typeof statusCode === 'number' ? statusCode : undefined)}
              min={100}
              max={599}
              style={{ width: 110 }}
            />
          </>
        )}
        actions={<ExportButton entity="open-platform.call-logs" query={logParams} executionMode="auto" />}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索调用日志" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleApply} width={190} />
            <SearchButton onClick={handleApply} />
          </>
        )}
        mobileFilters={(
          <>
            <DateRangeFilter
              type="dateRange"
              value={draftParams.range}
              onChange={(range) => {
                if (range) setField('range')(range);
              }}
              width="100%"
            />
            <FilterSelect
              placeholder="全部应用"
              items={appOptions.map((app) => ({ value: app.clientId, label: app.name }))}
              value={draftParams.clientId}
              onChange={(clientId) => setField('clientId')(clientId as string)}
              width="100%"
              filter
            />
            <FilterSelect
              placeholder="全部环境"
              items={OPEN_APP_ENVIRONMENTS.map((value) => ({ value, label: OPEN_APP_ENVIRONMENT_LABELS[value] }))}
              value={draftParams.environment}
              onChange={(environment) => setField('environment')(environment as OpenApiCallLog['environment'])}
              width="100%"
            />
          </>
        )}
        mobileActions={<ExportButton entity="open-platform.call-logs" query={logParams} executionMode="auto" variant="flat" />}
        actionTitle="统计操作"
      />

      {/*
        KPI 与图表基于预聚合的概览维度（时间范围 / 应用 / 环境），日志表额外支持
        关键字、方法、状态码等明细筛选。两者口径不同，这里显式说明，避免出现
        「筛选失败后日志剩 8 条、KPI 仍显示全部」这种自相矛盾的读数。
      */}
      {hasDetailFilters && (
        <Banner
          type="info"
          closeIcon={null}
          description="下方统计与图表按「时间范围 / 应用 / 环境」汇总，不受关键字、请求方法、调用结果、状态码等明细筛选影响；这些条件只作用于「调用日志」表。"
          style={{ marginBottom: 16 }}
        />
      )}

      <StatGrid minItemWidth={150} style={{ marginBottom: 16 }}>
        <StatCard title="调用总数" value={(overview?.totalCalls ?? 0).toLocaleString()} sub={`今日 ${overview?.todayCalls ?? 0}`} />
        <StatCard title="成功率" value={`${overview?.successRate ?? 0}%`} accent="#16a34a" sub={`成功 ${overview?.successCalls ?? 0}`} />
        <StatCard title="失败数" value={(overview?.failedCalls ?? 0).toLocaleString()} accent="#dc2626" />
        <StatCard title="平均耗时" value={`${overview?.avgDurationMs ?? 0} ms`} />
        <StatCard
          title="P95 耗时"
          value={`${overview?.p95DurationMs ?? 0} ms`}
          sub={overview?.percentilesPartial ? `仅基于近 ${overview.percentileRetentionDays} 天原始日志` : '95% 请求低于该值'}
        />
        <StatCard
          title="P99 耗时"
          value={`${overview?.p99DurationMs ?? 0} ms`}
          sub={overview?.percentilesPartial ? `仅基于近 ${overview.percentileRetentionDays} 天原始日志` : '99% 请求低于该值'}
        />
        <StatCard title="活跃应用" value={overview?.activeApps ?? 0} />
      </StatGrid>

      <Card style={{ marginBottom: 16 }} title={<Title heading={6} style={{ margin: 0 }}>调用趋势</Title>} loading={statLoading}>
        {trend.length ? <AreaChart {...trendSpec} options={chartOptions} height={280} /> : <EmptyChart height={280} />}
      </Card>

      <div className="chart-grid" style={{ marginBottom: 16 }}>
        <Card title={<Title heading={6} style={{ margin: 0 }}>应用调用 Top</Title>} loading={statLoading}>
          {byApp.length ? <BarChart {...appSpec} options={chartOptions} height={300} /> : <EmptyChart height={300} />}
        </Card>
        <Card title={<Title heading={6} style={{ margin: 0 }}>端点调用 Top</Title>} loading={statLoading}>
          {byEndpoint.length ? <BarChart {...endpointSpec} options={chartOptions} height={300} /> : <EmptyChart height={300} />}
        </Card>
      </div>

      <Card title={<Title heading={6} style={{ margin: 0 }}>调用日志</Title>}>
        <ConfigurableTable

          columns={logColumns}






          empty="暂无调用记录"
        {...listTableProps(logsQuery, { pagination: buildPagination })}
      />
      </Card>
    </div>
  );
}
