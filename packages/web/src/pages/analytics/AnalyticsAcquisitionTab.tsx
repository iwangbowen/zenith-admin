/**
 * 阶段 2：获客渠道与归因报表。
 *
 * 与「维度分布」的区别：维度分布按事件计数，同一用户多次访问会重复计入；
 * 本报表按用户归因——每个用户只归属于一条触点，因此各行用户数之和等于总用户数，
 * 可以直接用来比较渠道贡献。
 */
import { percentOf } from '@zenith/shared/core';
import { useMemo, useState } from 'react';
import { Card, Empty, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { AnalyticsAcquisitionDimension, AnalyticsAcquisitionRow, AnalyticsAttributionModel } from '@zenith/shared/analytics';
import {
  ANALYTICS_ACQUISITION_DIMENSION_OPTIONS,
  ANALYTICS_ATTRIBUTION_MODEL_OPTIONS,
} from '@zenith/shared/analytics';
import { BarChart, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { useAnalyticsAcquisition, useAnalyticsEventMeta } from '@/hooks/queries/analytics';
import { BEHAVIOR_DAYS_OPTIONS, useBehaviorDays } from './behavior-days-context';

const DAYS_OPTIONS = BEHAVIOR_DAYS_OPTIONS;

const MODEL_HINT: Record<AnalyticsAttributionModel, string> = {
  first_touch: '首次触点：把转化归功于「把用户带来的那条渠道」，用于评估拉新贡献。',
  last_touch: '末次触点：把转化归功于「转化前最后接触的渠道」，用于评估促单贡献。',
};

export default function AnalyticsAcquisitionTab() {
  const [days, setDays] = useBehaviorDays();
  const [dimension, setDimension] = useState<AnalyticsAcquisitionDimension>('channel');
  const [model, setModel] = useState<AnalyticsAttributionModel>('last_touch');
  const [conversionEvent, setConversionEvent] = useState<string | undefined>();
  const palette = useChartPalette();

  const query = useAnalyticsAcquisition({ days, dimension, model, conversionEvent, limit: 20 });
  const data = query.data ?? null;
  const rows = data?.rows ?? [];

  const eventMetaQuery = useAnalyticsEventMeta({ page: 1, pageSize: 200 });
  const eventOptions = useMemo(
    () => (eventMetaQuery.data?.list ?? []).map((m) => ({ value: m.eventName, label: m.displayName ? `${m.displayName}（${m.eventName}）` : m.eventName })),
    [eventMetaQuery.data?.list],
  );

  const chartData = useMemo(() => rows.map((r) => ({ __label: r.label, users: r.users, conversions: r.conversions })), [rows]);
  const barSpec = useMemo(() => makeBarSpec({
    data: chartData,
    xField: '__label',
    series: conversionEvent
      ? [
        { field: 'users', name: '归因用户', color: palette.primary },
        { field: 'conversions', name: '转化用户', color: palette.success ?? palette.primary },
      ]
      : [{ field: 'users', name: '归因用户', color: palette.primary }],
    palette,
    tooltip: { value: (v) => String(Math.round(Number(v))) },
  }), [chartData, conversionEvent, palette]);

  const columns = [
    { title: '来源', dataIndex: 'label', render: (value: string) => <Typography.Text>{value}</Typography.Text> },
    { title: '归因用户', dataIndex: 'users', width: 110, align: 'right' as const, render: (v: number) => v.toLocaleString() },
    {
      title: '新用户',
      align: 'right' as const,
      dataIndex: 'newUsers',
      width: 140,
      render: (v: number, record: AnalyticsAcquisitionRow) => (
        <Space spacing={4}>
          <span>{v.toLocaleString()}</span>
          {record.users > 0 && (
            <Typography.Text type="tertiary" size="small">{`${percentOf(v, record.users)}%`}</Typography.Text>
          )}
        </Space>
      ),
    },
    { title: '会话数', dataIndex: 'sessions', width: 100, align: 'right' as const, render: (v: number) => v.toLocaleString() },
    ...(conversionEvent
      ? [
        { title: '转化用户', dataIndex: 'conversions', width: 110, align: 'right' as const, render: (v: number) => v.toLocaleString() },
        {
          title: '转化率',
          align: 'right' as const,
          dataIndex: 'conversionRate',
          width: 110,
          render: (v: number) => <Typography.Text type={v > 0 ? 'success' : 'tertiary'}>{v.toFixed(1)}%</Typography.Text>,
        },
      ]
      : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Typography.Title heading={6}>获客与归因</Typography.Title>
      <Typography.Text type="tertiary" size="small">{MODEL_HINT[model]}</Typography.Text>
      <Card bodyStyle={{ padding: 16 }}>
        <Space wrap>
          <Select value={dimension} optionList={ANALYTICS_ACQUISITION_DIMENSION_OPTIONS} onChange={(v) => setDimension(v as AnalyticsAcquisitionDimension)} style={{ width: 150 }} />
          <Select value={model} optionList={ANALYTICS_ATTRIBUTION_MODEL_OPTIONS} onChange={(v) => setModel(v as AnalyticsAttributionModel)} style={{ width: 140 }} />
          <Select
            placeholder="转化事件（可选）"
            value={conversionEvent}
            optionList={eventOptions}
            loading={eventMetaQuery.isFetching}
            onChange={(v) => setConversionEvent(v as string | undefined)}
            filter
            showClear
            style={{ width: 240 }}
          />
          <Select value={days} optionList={DAYS_OPTIONS} onChange={(v) => setDays(Number(v))} style={{ width: 120 }} />
        </Space>
      </Card>

      <Card bodyStyle={{ padding: 16 }}>
        {rows.length === 0 ? (
          <Empty description={query.isFetching ? '加载中…' : '暂无获客数据'} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Space wrap>
              <Tag color="blue">{`区间 ${data?.startDate} ~ ${data?.endDate}`}</Tag>
              <Tag color="grey">{`归因用户 ${data?.totalUsers.toLocaleString()}`}</Tag>
              {conversionEvent && <Tag color="green">{`转化用户 ${data?.totalConversions.toLocaleString()}`}</Tag>}
            </Space>
            <BarChart {...barSpec} options={chartOptions} height={300} />
            <ConfigurableTable
              bordered
              rowKey="key"
              columns={columns}
              dataSource={rows}
              loading={query.isFetching}
              pagination={false}
              onRefresh={() => void query.refetch()}
              refreshLoading={query.isFetching}
              empty="暂无数据"
            />
          </div>
        )}
      </Card>
    </div>
  );
}
