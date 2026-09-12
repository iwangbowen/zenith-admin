import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, Select, Spin, Typography } from '@douyinfe/semi-ui';
import { AlertTriangle, BellRing, Clock, MailWarning, ShieldCheck, Timer } from 'lucide-react';
import {
  BarChart,
  LineChart,
  StatCard,
  StatGrid,
  chartOptions,
  makeBarSpec,
  makeLineSpec,
  useChartPalette,
} from '@/components/charts';
import type { MonitorAlertOverviewRange } from '@zenith/shared/platform';
import {
  MONITOR_ALERT_LEVEL_LABELS,
  MONITOR_ALERT_OVERVIEW_RANGE_OPTIONS,
} from '@zenith/shared/platform';
import { SearchToolbar } from '@/components/SearchToolbar';
import { RefreshButton } from '@/components/toolbar-controls';
import { useMonitorAlertOverview } from '@/hooks/queries/monitor-alerts';
import { usePermission } from '@/hooks/usePermission';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text } = Typography;

const LEVEL_ACCENT: Record<string, string> = {
  info: 'var(--semi-color-info)',
  warning: 'var(--semi-color-warning)',
  critical: 'var(--semi-color-danger)',
};

/** 时长按量级降级单位：把「1440 分钟」写成「1 天」才读得出严重程度 */
function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return EMPTY_PLACEHOLDER;
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 6) / 10} 小时`;
  return `${Math.round(minutes / 144) / 10} 天`;
}

export default function AlertOverviewPage() {
  const navigate = useNavigate();
  const palette = useChartPalette();
  const { hasPermission } = usePermission();
  const [range, setRange] = useState<MonitorAlertOverviewRange>('24h');
  const overviewQuery = useMonitorAlertOverview(range);
  const data = overviewQuery.data ?? null;
  const canViewEvents = hasPermission('alert:event:list');

  /** 统计卡跳转到告警事件页并带上对应筛选，让「看到数字」与「查明细」之间没有断层 */
  function gotoEvents(params: Record<string, string>) {
    if (!canViewEvents) return;
    navigate(`/alerts/events?${new URLSearchParams(params).toString()}`);
  }

  const trendSpec = useMemo(() => makeLineSpec({
    data: data?.trend ?? [],
    xField: 'date',
    series: [
      { field: 'fired', name: '触发' },
      { field: 'resolved', name: '已恢复' },
    ],
    palette,
    point: true,
    tooltip: { value: (v) => `${v} 次` },
  }), [data?.trend, palette]);

  const topRuleSpec = useMemo(() => makeBarSpec({
    data: data?.topRules ?? [],
    xField: 'ruleName',
    series: [{ field: 'count', name: '触发次数' }],
    palette,
    horizontal: true,
    showLabel: true,
    barMinHeight: 2,
    tooltip: { value: (v) => `${v} 次` },
  }), [data?.topRules, palette]);

  const rangeSelect = (
    <Select
      value={range}
      onChange={(v) => setRange(v as MonitorAlertOverviewRange)}
      style={{ width: 140 }}
      optionList={[...MONITOR_ALERT_OVERVIEW_RANGE_OPTIONS]}
    />
  );

  return (
    <div className="page-container zx-flat-panels">
      <SearchToolbar
        primary={(
          <>
            {rangeSelect}
            <RefreshButton onClick={() => void overviewQuery.refetch()} loading={overviewQuery.isFetching} />
          </>
        )}
        mobilePrimary={rangeSelect}
        mobileActions={<RefreshButton onClick={() => void overviewQuery.refetch()} loading={overviewQuery.isFetching} />}
        actionTitle="告警概览操作"
      />

      <Spin spinning={overviewQuery.isFetching && !data}>
        <StatGrid minItemWidth={190}>
          <StatCard
            title="当前告警中"
            value={data?.firingTotal ?? EMPTY_PLACEHOLDER}
            accent="var(--semi-color-danger)"
            icon={<BellRing size={19} />}
            onClick={canViewEvents ? () => gotoEvents({ status: 'firing' }) : undefined}
          />
          {(data?.firingByLevel ?? []).map((item) => (
            <StatCard
              key={item.level}
              title={`${MONITOR_ALERT_LEVEL_LABELS[item.level]}告警`}
              value={item.count}
              accent={LEVEL_ACCENT[item.level]}
              icon={<AlertTriangle size={19} />}
              onClick={canViewEvents ? () => gotoEvents({ status: 'firing', level: item.level }) : undefined}
            />
          ))}
          <StatCard
            title="待处理"
            value={data?.pendingTotal ?? EMPTY_PLACEHOLDER}
            sub={data?.oldestPendingMinutes == null ? undefined : `最久已等待 ${formatMinutes(data.oldestPendingMinutes)}`}
            accent="var(--semi-color-warning)"
            icon={<Clock size={19} />}
            onClick={canViewEvents ? () => gotoEvents({ status: 'firing', handleStatus: 'pending' }) : undefined}
          />
          <StatCard
            title="通知失败"
            value={data?.notifyFailedInRange ?? EMPTY_PLACEHOLDER}
            sub="配了渠道却没送达"
            accent="var(--semi-color-danger)"
            icon={<MailWarning size={19} />}
            onClick={canViewEvents ? () => gotoEvents({ notifyStatus: 'failed' }) : undefined}
          />
          <StatCard
            title="平均确认耗时"
            value={formatMinutes(data?.mttaMinutes)}
            sub="MTTA"
            icon={<Timer size={19} />}
          />
          <StatCard
            title="平均恢复耗时"
            value={formatMinutes(data?.mttrMinutes)}
            sub="MTTR"
            icon={<ShieldCheck size={19} />}
          />
        </StatGrid>

        {data && data.pendingTotal > 0 && (
          <Card style={{ marginTop: 16 }} bodyStyle={{ padding: '12px 16px' }}>
            <Text>
              有 <Text strong type="warning">{data.pendingTotal}</Text> 条告警仍无人认领
              {data.oldestPendingAt ? <>，最早一条触发于 <Text strong>{data.oldestPendingAt}</Text></> : null}
              {canViewEvents ? <>。<Text link onClick={() => gotoEvents({ status: 'firing', handleStatus: 'pending' })}>去处理</Text></> : null}
            </Text>
          </Card>
        )}

        <div className="chart-grid chart-grid--aside" style={{ marginTop: 16 }}>
          <Card
            title="触发与恢复趋势"
            bodyStyle={{ padding: 16 }}
            headerExtraContent={<Text type="tertiary" size="small">触发 {data?.firedInRange ?? 0} 次 · 已恢复 {data?.resolvedInRange ?? 0} 次</Text>}
          >
            {(data?.trend.length ?? 0) > 0
              ? <LineChart {...trendSpec} options={chartOptions} height={300} />
              : <Empty description="该时间范围内没有告警" style={{ padding: '86px 0' }} />}
          </Card>

          <Card
            title="触发最频繁的规则"
            bodyStyle={{ padding: 16 }}
            headerExtraContent={<Text type="tertiary" size="small">TOP 5</Text>}
          >
            {(data?.topRules.length ?? 0) > 0
              ? <BarChart {...topRuleSpec} options={chartOptions} height={300} />
              : <Empty description="该时间范围内没有告警" style={{ padding: '86px 0' }} />}
          </Card>
        </div>
      </Spin>
    </div>
  );
}
