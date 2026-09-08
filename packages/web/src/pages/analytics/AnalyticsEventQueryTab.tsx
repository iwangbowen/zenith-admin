/**
 * 行为中心阶段 1：通用事件分析工作台 —— 自定义事件 + 维度 + 指标查询，展示图表 + 明细表格。
 */
import { useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Select, Toast, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { BarChart, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { formatDateForApi } from '@/utils/date';
import { useAnalyticsEventMeta, useAnalyticsEventQuery, useAnalyticsSegments } from '@/hooks/queries/analytics';
import { usePagination } from '@/hooks/usePagination';
import type { AnalyticsEventQueryGroupByField, AnalyticsEventQueryInput, AnalyticsEventQueryMetric, AnalyticsEventQueryRow, AnalyticsSegmentPropertyFilter } from '@zenith/shared/analytics';
import { ANALYTICS_DEVICE_TYPE_OPTIONS, ANALYTICS_ENVIRONMENT_OPTIONS, ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS, ANALYTICS_EVENT_QUERY_GROUP_BY_OPTIONS, ANALYTICS_EVENT_QUERY_METRIC_OPTIONS, ANALYTICS_EVENT_SOURCE_OPTIONS, ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS, analyticsMetricRequiresProperty } from '@zenith/shared/analytics';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';

const DAY_OPTIONS = [7, 14, 30, 90].map((value) => ({ value, label: `近 ${value} 天` }));

/** 与后端 analyticsEventQuerySchema 的 propertyFilters.max(10) 对齐 */
const MAX_PROPERTY_FILTERS = 10;

interface PropertyFilterDraft {
  id: string;
  key: string;
  op: AnalyticsSegmentPropertyFilter['op'];
  value: string;
}

interface EventQueryDraft {
  days: number;
  dateRange?: [Date, Date];
  eventNames: string[];
  source?: string;
  appId?: string;
  environment?: string;
  deviceType?: string;
  segmentId?: number;
  propertyFilters: PropertyFilterDraft[];
  groupBy: AnalyticsEventQueryGroupByField[];
  metric: AnalyticsEventQueryMetric;
  metricProperty?: string;
}

const defaultDraft: EventQueryDraft = {
  days: 30,
  eventNames: [],
  propertyFilters: [],
  groupBy: ['date'],
  metric: 'events',
};

// 默认条件本身即可执行（全部事件 / 按日期分组 / 近 30 天），进入页签自动首查，避免先见空态
const defaultSubmitted: AnalyticsEventQueryInput = { groupBy: ['date'], metric: 'events', days: 30 };

/**
 * `in` 接收逗号分隔的多值；其余运算符按单值提交。
 * 数值型运算符（gt/gte/lt/lte）交由后端 `::numeric` 转换，此处不做前端类型推断，
 * 避免与后端比较口径产生两套语义。
 */
function toPropertyFilter(draft: PropertyFilterDraft): AnalyticsSegmentPropertyFilter | null {
  const key = draft.key.trim();
  if (!key) return null;
  if (draft.op === 'in') {
    const values = draft.value.split(',').map((v) => v.trim()).filter(Boolean);
    return values.length ? { key, op: 'in', value: values } : null;
  }
  const value = draft.value.trim();
  return value ? { key, op: draft.op, value } : null;
}

function rowKey(row?: AnalyticsEventQueryRow, index?: number): string {
  if (!row) return String(index ?? 0);
  return `${Object.values(row.dimensions).join('|')}-${index ?? 0}`;
}

export default function AnalyticsEventQueryTab() {
  const [draft, setDraft] = useState<EventQueryDraft>(defaultDraft);
  const [submitted, setSubmitted] = useState<AnalyticsEventQueryInput | null>(defaultSubmitted);
  const palette = useChartPalette();
  const { page, pageSize, resetPage, buildPagination } = usePagination();
  // 分页参数不进 submitted：翻页只改 page/pageSize，不应算作一次新的查询提交
  const queryInput = useMemo<AnalyticsEventQueryInput | null>(
    () => (submitted ? { ...submitted, page, pageSize } : null),
    [submitted, page, pageSize],
  );
  const eventQuery = useAnalyticsEventQuery(queryInput);
  const result = eventQuery.data ?? null;
  const loading = eventQuery.isFetching;

  // 事件名 lookup：从事件字典拉取，供多选下拉使用（最多展示 200 条，业务量级下足够覆盖）
  const eventMetaQuery = useAnalyticsEventMeta({ page: 1, pageSize: 200 });
  const eventNameOptions = useMemo(
    () => (eventMetaQuery.data?.list ?? []).map((m) => ({ value: m.eventName, label: m.displayName ? `${m.displayName}（${m.eventName}）` : m.eventName })),
    [eventMetaQuery.data?.list],
  );

  const segmentsQuery = useAnalyticsSegments({ page: 1, pageSize: 100, status: 'enabled' });
  const segmentOptions = useMemo(
    () => (segmentsQuery.data?.list ?? []).map((s) => ({ value: s.id, label: s.name })),
    [segmentsQuery.data?.list],
  );

  const updateDraft = <K extends keyof EventQueryDraft>(key: K, value: EventQueryDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const addPropertyFilter = () => {
    setDraft((prev) => (prev.propertyFilters.length >= MAX_PROPERTY_FILTERS ? prev : {
      ...prev,
      propertyFilters: [...prev.propertyFilters, { id: `pf-${Date.now()}-${prev.propertyFilters.length}`, key: '', op: 'eq', value: '' }],
    }));
  };

  const updatePropertyFilter = (id: string, patch: Partial<Omit<PropertyFilterDraft, 'id'>>) => {
    setDraft((prev) => ({
      ...prev,
      propertyFilters: prev.propertyFilters.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  };

  const removePropertyFilter = (id: string) => {
    setDraft((prev) => ({ ...prev, propertyFilters: prev.propertyFilters.filter((f) => f.id !== id) }));
  };

  const handleReset = () => {
    setDraft(defaultDraft);
    setSubmitted(defaultSubmitted);
    resetPage();
  };

  const handleQuery = () => {
    const propertyFilters = draft.propertyFilters
      .map(toPropertyFilter)
      .filter((f): f is AnalyticsSegmentPropertyFilter => f != null);
    const metricProperty = draft.metricProperty?.trim() || undefined;
    // 服务端 schema 会拒绝缺 key 的数值指标；前端先拦一道，给出比 400 更明确的提示
    if (analyticsMetricRequiresProperty(draft.metric) && !metricProperty) {
      Toast.warning('该指标需要填写数值属性 key');
      return;
    }
    const body: AnalyticsEventQueryInput = {
      eventNames: draft.eventNames.length ? draft.eventNames.slice(0, 20) : undefined,
      source: (draft.source as AnalyticsEventQueryInput['source']) || undefined,
      appId: draft.appId?.trim() || undefined,
      environment: (draft.environment as AnalyticsEventQueryInput['environment']) || undefined,
      deviceType: (draft.deviceType as AnalyticsEventQueryInput['deviceType']) || undefined,
      segmentId: draft.segmentId,
      propertyFilters: propertyFilters.length ? propertyFilters : undefined,
      groupBy: draft.groupBy.length ? draft.groupBy : ['date'],
      metric: draft.metric,
      metricProperty,
    };
    if (draft.dateRange) {
      body.startDate = formatDateForApi(draft.dateRange[0]);
      body.endDate = formatDateForApi(draft.dateRange[1]);
    } else {
      body.days = draft.days;
    }
    resetPage();
    setSubmitted(body);
  };

  const primaryDim = result?.queryMeta.groupBy[0];
  const metricLabel = ANALYTICS_EVENT_QUERY_METRIC_OPTIONS.find((o) => o.value === (result?.queryMeta.metric ?? draft.metric))?.label ?? '指标值';

  const chartData = useMemo(
    () => (result?.list ?? []).map((row) => ({ __label: primaryDim ? row.dimensions[primaryDim] ?? '–' : '–', value: row.value })),
    [result?.list, primaryDim],
  );

  const barSpec = useMemo(() => makeBarSpec({
    data: chartData,
    xField: '__label',
    series: [{ field: 'value', name: metricLabel, color: palette.primary }],
    palette,
    tooltip: { value: (v) => String(Math.round(Number(v))) },
  }), [chartData, metricLabel, palette]);

  const columns: ColumnProps<AnalyticsEventQueryRow>[] = useMemo(() => {
    const groupBy = result?.queryMeta.groupBy ?? draft.groupBy;
    const dimCols: ColumnProps<AnalyticsEventQueryRow>[] = groupBy.map((dim) => ({
      title: ANALYTICS_EVENT_QUERY_GROUP_BY_LABELS[dim] ?? dim,
      dataIndex: dim,
      render: (_: unknown, record: AnalyticsEventQueryRow) => record.dimensions[dim] ?? '–',
    }));
    return [
      ...dimCols,
      { title: metricLabel, dataIndex: 'value', width: 140, render: (value: number) => Math.round(value).toLocaleString() },
    ];
  }, [result?.queryMeta.groupBy, draft.groupBy, metricLabel]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Typography.Title heading={6}>事件分析</Typography.Title>
      <Typography.Text type="tertiary" size="small">
        自由组合事件、维度、属性与指标进行探索性分析；支持最多 2 个分组维度、{MAX_PROPERTY_FILTERS} 个属性过滤条件。
      </Typography.Text>
      <Card bodyStyle={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 12 }}>
          <div>
            <Typography.Text type="tertiary" size="small">事件（最多 20 个，留空表示全部）</Typography.Text>
            <Select
              multiple
              filter
              placeholder="全部事件"
              value={draft.eventNames}
              optionList={eventNameOptions}
              onChange={(v) => updateDraft('eventNames', (v as string[]) ?? [])}
              loading={eventMetaQuery.isFetching}
              showClear
              style={{ width: '100%' }}
              maxTagCount={2}
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">分组维度（1~2 个）</Typography.Text>
            <Select
              multiple
              placeholder="按日期"
              value={draft.groupBy}
              optionList={ANALYTICS_EVENT_QUERY_GROUP_BY_OPTIONS}
              onChange={(v) => updateDraft('groupBy', ((v as AnalyticsEventQueryGroupByField[]) ?? []).slice(0, 2))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">指标</Typography.Text>
            <Select value={draft.metric} optionList={ANALYTICS_EVENT_QUERY_METRIC_OPTIONS} onChange={(v) => updateDraft('metric', v as AnalyticsEventQueryMetric)} style={{ width: '100%' }} />
          </div>
          {analyticsMetricRequiresProperty(draft.metric) && (
            <div>
              <Typography.Text type="tertiary" size="small">数值属性 key（必填）</Typography.Text>
              <Input
                placeholder="如 amount"
                value={draft.metricProperty ?? ''}
                onChange={(value) => updateDraft('metricProperty', value)}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div>
            <Typography.Text type="tertiary" size="small">来源</Typography.Text>
            <FilterSelect
              placeholder="全部来源"
              items={ANALYTICS_EVENT_SOURCE_OPTIONS}
              value={draft.source}
              onChange={(v) => updateDraft('source', v as string)}
              width="100%"
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">环境</Typography.Text>
            <FilterSelect
              placeholder="全部环境"
              items={ANALYTICS_ENVIRONMENT_OPTIONS}
              value={draft.environment}
              onChange={(v) => updateDraft('environment', v as string)}
              width="100%"
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">设备</Typography.Text>
            <FilterSelect
              placeholder="全部设备"
              items={ANALYTICS_DEVICE_TYPE_OPTIONS}
              value={draft.deviceType}
              onChange={(v) => updateDraft('deviceType', v as string)}
              width="100%"
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">仅统计分群</Typography.Text>
            <FilterSelect
              placeholder="全部用户"
              items={segmentOptions}
              value={draft.segmentId}
              onChange={(v) => updateDraft('segmentId', v)}
              width="100%"
              loading={segmentsQuery.isFetching}
            />
          </div>
          <div>
            <Typography.Text type="tertiary" size="small">日期</Typography.Text>
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                value={draft.dateRange ? undefined : draft.days}
                placeholder="最近 N 天"
                optionList={DAY_OPTIONS}
                onChange={(v) => setDraft((prev) => ({ ...prev, days: Number(v), dateRange: undefined }))}
                style={{ width: 130 }}
              />
              <DateRangeFilter
                type="dateRange"
                value={draft.dateRange}
                onChange={(range) => setDraft((prev) => ({ ...prev, dateRange: range ?? undefined }))}
                style={{ flex: 1 }}
              />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="tertiary" size="small">
            属性过滤（可选，最多 {MAX_PROPERTY_FILTERS} 条，条件之间为「且」关系）
          </Typography.Text>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {draft.propertyFilters.map((filter) => (
              <div
                key={filter.id}
                style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 110px minmax(120px, 1.4fr) 36px', gap: 8, alignItems: 'center' }}
              >
                <Input
                  placeholder="属性 key（如 plan）"
                  value={filter.key}
                  onChange={(value) => updatePropertyFilter(filter.id, { key: value })}
                />
                <Select
                  value={filter.op}
                  optionList={ANALYTICS_SEGMENT_COMPARE_OP_OPTIONS}
                  onChange={(v) => updatePropertyFilter(filter.id, { op: v as AnalyticsSegmentPropertyFilter['op'] })}
                />
                <Input
                  placeholder={filter.op === 'in' ? '多个值用英文逗号分隔' : '属性值'}
                  value={filter.value}
                  onChange={(value) => updatePropertyFilter(filter.id, { value })}
                />
                <Button
                  icon={<Trash2 size={14} />}
                  type="danger"
                  theme="borderless"
                  aria-label="删除该属性过滤条件"
                  onClick={() => removePropertyFilter(filter.id)}
                />
              </div>
            ))}
          </div>
          <Button
            icon={<Plus size={14} />}
            theme="borderless"
            style={{ marginTop: draft.propertyFilters.length ? 8 : 4 }}
            disabled={draft.propertyFilters.length >= MAX_PROPERTY_FILTERS}
            onClick={addPropertyFilter}
          >
            添加属性条件
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <SearchButton onClick={handleQuery} loading={loading} />
          <ResetButton onClick={handleReset} />
        </div>
      </Card>

      <Card title="分析结果" bodyStyle={{ padding: 16 }}>
        {!result ? (
          <Empty description={eventQuery.isError ? '查询失败，请检查筛选条件后重试' : loading ? '查询中…' : '暂无数据'} />
        ) : result.list.length === 0 ? (
          <Empty description="暂无匹配数据" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Typography.Text type="tertiary" size="small">
              区间 {result.queryMeta.startDate} ~ {result.queryMeta.endDate} · 共 {result.total} 行
            </Typography.Text>
            {result.queryMeta.groupBy.length === 1 && (
              <BarChart {...barSpec} options={chartOptions} height={280} />
            )}
            <ConfigurableTable
              bordered
              rowKey={rowKey}
              columns={columns}
              dataSource={result.list}
              loading={loading}
              pagination={buildPagination(result.total)}
              empty="暂无数据"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
