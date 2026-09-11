import { useMemo } from 'react';
import { Card, Spin, Table, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, BellRing, Boxes, Cpu, Radio } from 'lucide-react';
import {
  AreaChart, BarChart, EmptyChart, PieChart, StatCard, StatGrid, chartOptions,
  makeAreaSpec, makeBarSpec, makePieSpec, useChartPalette,
} from '@/components/charts';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  IOT_ALARM_LEVEL_LABELS, IOT_ALARM_STATUS_LABELS, IOT_DEVICE_EVENT_KIND_LABELS, IOT_EVENT_LEVEL_LABELS,
} from '@zenith/shared/iot';
import type { IotAlarm, IotDeviceEvent } from '@zenith/shared/iot';
import { useIotDashboard } from '@/hooks/queries/iot-dashboard';
import { IOT_ALARM_LEVEL_COLORS, IOT_EVENT_LEVEL_COLORS } from './iot-tag-colors';
import { shortDate } from '@/utils/date';

const { Text } = Typography;

const PIE_COLORS = ['#4c8bf5', '#07c160', '#fa8c16', '#9254de', '#13c2c2', '#f5576c'];

type RecentEvent = IotDeviceEvent & { deviceName?: string | null };

export default function IotDashboardPage() {
  const palette = useChartPalette();
  const query = useIotDashboard();
  const data = query.data;
  const stats = data?.stats;

  const onlineTrendSpec = useMemo(() => makeAreaSpec({
    data: data?.onlineTrend ?? [],
    xField: 'time',
    series: [
      { field: 'online', name: '在线设备', color: palette.primary },
      { field: 'total', name: '设备总数', color: '#c0c6cf' },
    ],
    palette,
    fillOpacity: 0.14,
    axis: { xLabel: (v) => String(v).slice(11, 16) },
    tooltip: { title: (v) => `时间：${v}` },
  }), [data?.onlineTrend, palette]);

  const alarmTrendSpec = useMemo(() => makeBarSpec({
    data: data?.alarmTrend ?? [],
    xField: 'date',
    series: [
      { field: 'warning', name: '警告', color: '#fa8c16' },
      { field: 'critical', name: '严重', color: '#f5576c' },
    ],
    palette,
    stack: true,
    axis: { xLabel: (v) => shortDate(String(v)) },
  }), [data?.alarmTrend, palette]);

  const distributionSpec = useMemo(() => makePieSpec({
    data: data?.productDistribution ?? [],
    categoryField: 'name',
    valueField: 'value',
    donut: true,
    colors: (data?.productDistribution ?? []).map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
    palette,
  }), [data?.productDistribution, palette]);

  const alarmColumns: ColumnProps<IotAlarm>[] = [
    {
      title: '状态', dataIndex: 'status', width: 84,
      render: (v: IotAlarm['status']) => (
        <Tag size="small" color={v === 'firing' ? 'red' : 'green'}>{IOT_ALARM_STATUS_LABELS[v]}</Tag>
      ),
    },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: IotAlarm['level']) => (
        <Tag size="small" color={IOT_ALARM_LEVEL_COLORS[v]}>{IOT_ALARM_LEVEL_LABELS[v]}</Tag>
      ),
    },
    { title: '规则', dataIndex: 'ruleName', width: 140, render: (v: string) => renderEllipsis(v) },
    { title: '设备', dataIndex: 'deviceName', width: 140, render: (v: string | null) => renderEllipsis(v) },
    { title: '内容', dataIndex: 'message', render: (v: string) => renderEllipsis(v) },
    dateTimeColumn<IotAlarm>('触发时间', 'firedAt'),
  ];

  const eventColumns: ColumnProps<RecentEvent>[] = [
    dateTimeColumn<RecentEvent>('时间', 'reportedAt'),
    {
      title: '类型', dataIndex: 'kind', width: 100,
      render: (v: RecentEvent['kind']) => (
        <Tag size="small" color={v === 'lifecycle' ? 'grey' : 'cyan'}>{IOT_DEVICE_EVENT_KIND_LABELS[v]}</Tag>
      ),
    },
    { title: '设备', dataIndex: 'deviceName', width: 140, render: (v: string | null) => renderEllipsis(v) },
    { title: '事件', dataIndex: 'name', width: 130, render: (v: string) => renderEllipsis(v) },
    {
      title: '级别', dataIndex: 'level', width: 80,
      render: (v: RecentEvent['level']) => (
        <Tag size="small" color={IOT_EVENT_LEVEL_COLORS[v]}>{IOT_EVENT_LEVEL_LABELS[v]}</Tag>
      ),
    },
  ];

  return (
    <div className="page-container zx-flat-panels">
      <Spin spinning={query.isPending}>
        <StatGrid style={{ marginBottom: 16 }}>
          <StatCard
            title="设备在线率"
            icon={<Radio size={14} />}
            value={`${stats?.onlineRate ?? 0}%`}
            sub={`在线 ${stats?.onlineCount ?? 0} / 共 ${stats?.deviceTotal ?? 0} 台`}
            accent="var(--semi-color-success)"
          />
          <StatCard
            title="今日遥测量"
            icon={<Activity size={14} />}
            value={stats?.telemetryToday ?? 0}
            sub="今天 0 点起累计上报点数"
          />
          <StatCard
            title="活跃告警"
            icon={<BellRing size={14} />}
            value={(stats?.firingWarning ?? 0) + (stats?.firingCritical ?? 0)}
            sub={`严重 ${stats?.firingCritical ?? 0} · 警告 ${stats?.firingWarning ?? 0}`}
            accent={(stats?.firingCritical ?? 0) > 0 ? 'var(--semi-color-danger)' : undefined}
          />
          <StatCard
            title="期望值待确认"
            icon={<Cpu size={14} />}
            value={stats?.pendingDesiredDevices ?? 0}
            sub="存在未收敛期望属性的设备数"
          />
          <StatCard
            title="产品数"
            icon={<Boxes size={14} />}
            value={stats?.productTotal ?? 0}
            sub="启用与禁用产品合计"
          />
        </StatGrid>

        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <Card title="在线趋势（近 24 小时）">
            {(data?.onlineTrend.length ?? 0) === 0
              ? <EmptyChart height={240} text="暂无在线采样，离线扫描任务运行后逐步生成" />
              : <AreaChart {...onlineTrendSpec} options={chartOptions} height={240} />}
          </Card>
          <Card title="告警趋势（近 7 天）">
            {(data?.alarmTrend ?? []).every((d) => d.warning === 0 && d.critical === 0)
              ? <EmptyChart height={240} text="近 7 天无告警" />
              : <BarChart {...alarmTrendSpec} options={chartOptions} height={240} />}
          </Card>
        </div>

        <div className="chart-grid" style={{ marginBottom: 16 }}>
          <Card title="产品设备分布">
            {(data?.productDistribution.length ?? 0) === 0
              ? <EmptyChart height={240} />
              : <PieChart {...distributionSpec} options={chartOptions} height={240} />}
          </Card>
          <Card title="最近告警">
            <Table
              columns={alarmColumns} dataSource={data?.recentAlarms ?? []} rowKey="id"
              size="small" pagination={false} empty="暂无告警"
            />
          </Card>
        </div>

        <Card title="最近设备事件">
          <Table
            columns={eventColumns} dataSource={(data?.recentEvents ?? []) as RecentEvent[]} rowKey="id"
            size="small" pagination={false} empty="暂无设备事件"
          />
        </Card>
        <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
          数据每 30 秒自动刷新；在线趋势来自每分钟一次的在线率采样，长窗口遥测图表使用小时聚合。
        </Text>
      </Spin>
    </div>
  );
}
