/* eslint-disable react-refresh/only-export-components */
import { Tag } from '@douyinfe/semi-ui';
import { NOTIFY_CHANNEL_LABELS } from '@zenith/shared/messaging';
import type { MonitorMetric } from '@zenith/shared/platform';
import { FilterSelect } from '@/components/search-filters';
import {
  MONITOR_ALERT_LEVEL_CONFIG as LEVEL_CONFIG,
  MONITOR_METRIC_GROUPED_OPTIONS as METRIC_GROUPS,
  MONITOR_METRIC_LABELS as METRIC_LABELS,
  formatMonitorMetricValue,
} from './rules/constants';

export const MONITOR_OPERATOR_SYMBOLS: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
/** 告警的渠道数组是 string[]，用宽类型视图查标签，未知渠道回落到原值 */
export const MONITOR_CHANNEL_LABELS: Record<string, string> = NOTIFY_CHANNEL_LABELS;

const METRIC_FILTER_GROUPS = METRIC_GROUPS.map((group) => ({ label: group.label, items: group.children }));

interface MonitorMetricFilterSelectProps {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}

export function MonitorMetricFilterSelect({ value, onChange }: MonitorMetricFilterSelectProps) {
  return <FilterSelect placeholder="全部指标" groups={METRIC_FILTER_GROUPS} value={value} onChange={onChange} width={170} filter />;
}

interface MonitorMetricConditionProps {
  metric: MonitorMetric;
  operator: string;
  threshold: number;
}

export function MonitorMetricCondition({ metric, operator, threshold }: MonitorMetricConditionProps) {
  return (
    <span>
      <Tag size="small" type="ghost">{METRIC_LABELS[metric] ?? metric}</Tag>
      {' '}{MONITOR_OPERATOR_SYMBOLS[operator] ?? operator} {formatMonitorMetricValue(metric, threshold)}
    </span>
  );
}

export function MonitorAlertLevelTag({ level }: { level: string }) {
  return <Tag color={LEVEL_CONFIG[level]?.color ?? 'grey'} size="small">{LEVEL_CONFIG[level]?.label ?? level}</Tag>;
}

export function MonitorAlertStateTag({ state, okText }: { state: string; okText: string }) {
  return state === 'firing'
    ? <Tag color="red" size="small">告警中</Tag>
    : <Tag color="green" size="small">{okText}</Tag>;
}
