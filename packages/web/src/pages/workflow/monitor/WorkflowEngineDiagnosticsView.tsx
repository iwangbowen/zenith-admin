import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Dropdown, Empty, Form, JsonViewer, List, Modal, Popover, Row, Select, Skeleton, Space, Tabs, TabPane, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, DatabaseZap, Download, GaugeCircle, GitBranch, Layers, LifeBuoy, Minus, RefreshCw, Stethoscope, Timer, TimerReset, TrendingUp, Wrench, Workflow, Zap } from 'lucide-react';
import type {
  WorkflowEngineActionKey,
  WorkflowEngineActionPreview,
  WorkflowEngineActionResult,
  WorkflowEngineActionSampleJob,
  WorkflowEngineComponent,
  WorkflowEngineComponentStatus,
  WorkflowEngineDefinitionValidationItem,
  WorkflowEngineHealthHistory,
  WorkflowEngineHistogramBucket,
  WorkflowEngineIntrospection,
  WorkflowEngineOutboxEvent,
  WorkflowEngineQueueKey,
  WorkflowEngineQueueSnapshot,
  WorkflowEngineRuntimeIssue,
  WorkflowEngineRuntimeTask,
  WorkflowEngineTriggerExecution,
} from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import { AreaChart, LineChart, chartOptions, makeAreaSpec, makeLineSpec, useChartPalette, type ChartPalette } from '@/components/charts';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import WorkflowBatchRecoveryModal from './WorkflowBatchRecoveryModal';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

interface Props {
  /** 深链：打开某个实例的运行时诊断抽屉（由 WorkflowMonitorPage 提供） */
  onOpenInstanceDiagnostics?: (instanceId: number) => void;
}

const STATUS_META: Record<WorkflowEngineComponentStatus, { text: string; color: TagColor }> = {
  healthy: { text: '正常', color: 'green' },
  warning: { text: '关注', color: 'orange' },
  critical: { text: '严重', color: 'red' },
};

const ISSUE_META: Record<WorkflowEngineRuntimeIssue['severity'], { text: string; color: TagColor }> = {
  info: { text: '信息', color: 'blue' },
  warning: { text: '警告', color: 'orange' },
  critical: { text: '严重', color: 'red' },
};

const QUEUE_LABEL: Record<WorkflowEngineQueueKey, string> = {
  humanTasks: '人工任务',
  delayWakeups: '延时唤醒',
  timeouts: '超时处理',
  triggerDispatch: '触发器调度',
  externalApprovals: '外部审批',
  subProcessJoin: '子流程汇聚',
  eventOutbox: '事件派发',
};

const REF_TYPE_LABEL: Record<NonNullable<WorkflowEngineRuntimeIssue['refType']>, string> = {
  definition: '定义',
  instance: '实例',
  task: '任务',
  triggerExecution: '触发器执行',
  outbox: '事件派发',
  scheduler: '调度器',
};

const NODE_TYPE_LABEL: Record<string, string> = {
  start: '开始', approve: '审批', handler: '办理', end: '结束',
  exclusiveGateway: '条件网关', parallelGateway: '并行网关', inclusiveGateway: '包容网关', routeGateway: '路由网关',
  ccNode: '抄送', delay: '延时', trigger: '触发器', subProcess: '子流程', catchNode: '捕获',
};

const JOB_TYPE_LABEL: Record<string, string> = {
  delay_wake: '延时唤醒', task_timeout: '任务超时', trigger_dispatch: '触发器派发', external_dispatch: '外部派发',
  subprocess_spawn: '子流程发起', subprocess_join: '子流程汇聚', event_dispatch: '事件派发', webhook_delivery: 'Webhook 投递',
  compensation_action: '补偿动作',
};

const JOB_STATUS_META: Record<string, { text: string; color: TagColor }> = {
  pending: { text: '待处理', color: 'grey' },
  running: { text: '运行中', color: 'blue' },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'orange' },
  dead: { text: '死信', color: 'red' },
  canceled: { text: '已取消', color: 'grey' },
};

const THRESHOLD_OPTIONS = [
  { label: '15 分钟', value: 15 },
  { label: '30 分钟', value: 30 },
  { label: '1 小时', value: 60 },
  { label: '3 小时', value: 180 },
  { label: '12 小时', value: 720 },
];

const AUTO_REFRESH_OPTIONS = [
  { label: '手动刷新', value: 0 },
  { label: '每 10 秒', value: 10 },
  { label: '每 30 秒', value: 30 },
  { label: '每 60 秒', value: 60 },
];

const HISTORY_RANGE_OPTIONS = [
  { label: '近 6 小时', value: 6 },
  { label: '近 24 小时', value: 24 },
  { label: '近 3 天', value: 72 },
  { label: '近 7 天', value: 168 },
];

const ACTION_ITEMS: Array<{ key: WorkflowEngineActionKey; label: string }> = [
  { key: 'replay-outbox', label: '重放事件派发' },
  { key: 'recover-triggers', label: '恢复触发器重派' },
  { key: 'recover-delays', label: '恢复延时任务' },
  { key: 'process-timeouts', label: '处理超时任务' },
  { key: 'recover-webhooks', label: '恢复 Webhook 投递' },
  { key: 'recover-subprocess', label: '恢复子流程' },
];

const QUEUE_SEGMENTS = [
  { key: 'ready' as const, label: 'Ready' },
  { key: 'running' as const, label: 'Running' },
  { key: 'delayed' as const, label: 'Delayed' },
  { key: 'failed' as const, label: 'Failed' },
];

const STATUS_RANK: Record<WorkflowEngineComponentStatus, number> = { healthy: 0, warning: 1, critical: 2 };

function statusTag(status: WorkflowEngineComponentStatus) {
  const meta = STATUS_META[status];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function issueTag(severity: WorkflowEngineRuntimeIssue['severity']) {
  const meta = ISSUE_META[severity];
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function rawTag(value: string | null | undefined, color: TagColor = 'grey') {
  return value ? <Tag color={color}>{value}</Tag> : <Typography.Text type="tertiary">—</Typography.Text>;
}

function formatAge(value: number | null | undefined) {
  if (value == null) return '—';
  if (value >= 24 * 60) {
    const days = Math.floor(value / (24 * 60));
    const hours = Math.floor((value % (24 * 60)) / 60);
    return `${days} 天 ${hours} 小时`;
  }
  if (value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = value % 60;
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return `${value} 分钟`;
}

function formatMs(value: number | null | undefined) {
  if (value == null) return '—';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function statusColor(palette: ChartPalette, status: WorkflowEngineComponentStatus | null | undefined): string {
  if (status === 'critical') return palette.danger;
  if (status === 'warning') return palette.warning;
  return palette.success;
}

/** 'YYYY-MM-DD HH:mm:ss' -> 'HH:mm' */
function hourLabel(value: string) {
  return value.length >= 16 ? value.slice(11, 16) : value;
}

/** 'YYYY-MM-DD HH:mm:ss' -> 'MM-DD HH:mm' */
function hourTooltip(value: string) {
  return value.length >= 16 ? value.slice(5, 16) : value;
}

function renderJsonBlock(value: unknown) {
  return (
    <JsonViewer
      value={JSON.stringify(value, null, 2)}
      width="100%"
      height={520}
      showSearch
      options={{ readOnly: true, autoWrap: true, formatOptions: { tabSize: 2 } }}
    />
  );
}

function renderComponentIcon(component: WorkflowEngineComponent, color: string) {
  if (component.key === 'scheduler' || component.key === 'delayScheduler' || component.key === 'timeoutProcessor') {
    return <TimerReset size={16} color={color} />;
  }
  if (component.key === 'eventBus' || component.key === 'outbox') {
    return <DatabaseZap size={16} color={color} />;
  }
  if (component.key === 'dagExecutor' || component.key === 'subProcessRecovery') {
    return <GitBranch size={16} color={color} />;
  }
  return <Activity size={16} color={color} />;
}

function SectionTitle({ icon, title, desc, extra }: Readonly<{ icon: React.ReactNode; title: string; desc?: string; extra?: React.ReactNode }>) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      {icon}
      <Typography.Text strong>{title}</Typography.Text>
      {desc && <Typography.Text type="tertiary" size="small">{desc}</Typography.Text>}
      {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
    </div>
  );
}

function HealthRadial({ score, palette }: Readonly<{ score: number; palette: ChartPalette }>) {
  const band = score >= 90
    ? { label: '正常', color: palette.success }
    : score >= 70
      ? { label: '关注', color: palette.warning }
      : { label: '严重', color: palette.danger };
  const frac = Math.max(0, Math.min(1, score / 100));
  const r = 60;
  const cx = 80;
  const cy = 80;
  const arc = (start: number, end: number) => {
    const x0 = cx + r * Math.cos(start);
    const y0 = cy - r * Math.sin(start);
    const x1 = cx + r * Math.cos(end);
    const y1 = cy - r * Math.sin(end);
    const large = Math.abs(end - start) > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  return (
    <svg width={160} height={102} viewBox="0 0 160 102" role="img" aria-label={`健康分 ${score}`}>
      <path d={arc(Math.PI, 0)} fill="none" stroke={palette.fill1} strokeWidth={11} strokeLinecap="round" />
      <path d={arc(Math.PI, Math.PI * (1 - frac))} fill="none" stroke={band.color} strokeWidth={11} strokeLinecap="round" />
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={32} fontWeight={700} fill={palette.text0}>{score}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize={12} fill={palette.text2}>健康分 · {band.label}</text>
    </svg>
  );
}

function MicroStat({ label, value, color }: Readonly<{ label: string; value: number | string; color?: string }>) {
  return (
    <div style={{ minWidth: 0, padding: '4px 0' }}>
      <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }}>{label}</Typography.Text>
      <div style={{ fontSize: 16, fontWeight: 600, color, lineHeight: 1.3 }}>{value}</div>
    </div>
  );
}

/** 同比变化 chip：invert=true 表示数值越低越好（错误/延迟），用于上色。 */
function DeltaChip({ current, prev, invert, palette, suffix }: Readonly<{ current: number; prev: number; invert?: boolean; palette: ChartPalette; suffix?: string }>) {
  if (prev <= 0 && current <= 0) return null;
  const diff = current - prev;
  const pct = prev > 0 ? (diff / prev) * 100 : (current > 0 ? 100 : 0);
  if (Math.abs(pct) < 0.5) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: palette.text2, fontSize: 11 }}>
        <Minus size={11} /> 持平
      </span>
    );
  }
  const up = diff > 0;
  const bad = invert ? up : !up;
  const color = bad ? palette.danger : palette.success;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color, fontSize: 11 }} title="对比前一个 24h 窗口">
      <Icon size={11} />{Math.abs(pct).toFixed(0)}%{suffix ?? ''}
    </span>
  );
}

function GoldenTile({ icon, label, value, accent, sub, delta }: Readonly<{ icon: React.ReactNode; label: string; value: React.ReactNode; accent?: string; sub: React.ReactNode; delta?: React.ReactNode }>) {
  return (
    <div
      style={{
        flex: '1 1 170px',
        minWidth: 150,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--semi-color-fill-0)',
        border: '1px solid var(--semi-color-border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon}
        <Typography.Text type="tertiary" size="small">{label}</Typography.Text>
        {delta && <span style={{ marginLeft: 'auto' }}>{delta}</span>}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4, color: accent, lineHeight: 1.2 }}>{value}</div>
      <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block', marginTop: 2 }}>{sub}</Typography.Text>
    </div>
  );
}

function ScoreBreakdown({ data, palette }: Readonly<{ data: WorkflowEngineIntrospection; palette: ChartPalette }>) {
  const items = data.telemetry.scoreBreakdown;
  return (
    <div style={{ padding: 12, maxWidth: 280 }}>
      <Typography.Text strong>健康分构成</Typography.Text>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0', paddingBottom: 6, borderBottom: '1px solid var(--semi-color-border)' }}>
        <Typography.Text type="tertiary" size="small">满分基线</Typography.Text>
        <Typography.Text size="small">100</Typography.Text>
      </div>
      {items.length === 0 ? (
        <Typography.Text type="tertiary" size="small">未发现扣分项，引擎处于满分健康状态。</Typography.Text>
      ) : items.map((f) => (
        <div key={f.reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
          <Typography.Text size="small">{f.reason}</Typography.Text>
          <Typography.Text size="small" strong style={{ color: f.severity === 'critical' ? palette.danger : palette.warning }}>-{f.delta}</Typography.Text>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--semi-color-border)' }}>
        <Typography.Text strong size="small">当前健康分</Typography.Text>
        <Typography.Text strong size="small">{data.telemetry.healthScore}</Typography.Text>
      </div>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 6 }}>
        判定阈值：≥{data.thresholds.healthWarn} 正常 · ≥{data.thresholds.healthCritical} 关注
      </Typography.Text>
    </div>
  );
}

function HistogramBars({ buckets, color }: Readonly<{ buckets: WorkflowEngineHistogramBucket[]; color: string }>) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {buckets.map((b) => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Typography.Text type="tertiary" size="small" style={{ width: 64, minWidth: 64, textAlign: 'right' }}>{b.label}</Typography.Text>
          <div style={{ flex: 1, minWidth: 0, height: 12, background: 'var(--semi-color-fill-0)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: color, opacity: 0.85 }} />
          </div>
          <Typography.Text size="small" style={{ width: 64, minWidth: 64 }}>
            {b.count}
            <Typography.Text type="tertiary" size="small">{total > 0 ? ` ${Math.round((b.count / total) * 100)}%` : ''}</Typography.Text>
          </Typography.Text>
        </div>
      ))}
    </div>
  );
}

function ApdexBar({ data, palette }: Readonly<{ data: WorkflowEngineIntrospection; palette: ChartPalette }>) {
  const a = data.telemetry.apdex;
  if (a.total === 0) {
    return <Typography.Text type="tertiary" size="small">近 24h 暂无成功事件样本</Typography.Text>;
  }
  const seg = [
    { v: a.satisfied, color: palette.success, label: '满意' },
    { v: a.tolerating, color: palette.warning, label: '容忍' },
    { v: a.frustrated, color: palette.danger, label: '沮丧' },
  ];
  const scoreColor = a.score == null ? palette.text1 : a.score >= 0.94 ? palette.success : a.score >= 0.85 ? palette.warning : palette.danger;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <Typography.Text strong style={{ fontSize: 20, color: scoreColor }}>{a.score != null ? a.score.toFixed(2) : '—'}</Typography.Text>
        <Typography.Text type="tertiary" size="small">Apdex · T={a.thresholdMs}ms</Typography.Text>
      </div>
      <div style={{ display: 'flex', height: 12, borderRadius: 3, overflow: 'hidden', background: 'var(--semi-color-fill-0)' }}>
        {seg.map((s) => s.v > 0 && (
          <div key={s.label} title={`${s.label} ${s.v}`} style={{ width: `${(s.v / a.total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <Space spacing={12} style={{ marginTop: 6 }}>
        {seg.map((s) => (
          <Space key={s.label} spacing={4} align="center">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            <Typography.Text type="tertiary" size="small">{s.label} {s.v}</Typography.Text>
          </Space>
        ))}
      </Space>
    </div>
  );
}

function QueueSaturation({ queues, palette }: Readonly<{ queues: WorkflowEngineQueueSnapshot[]; palette: ChartPalette }>) {
  const segColor: Record<string, string> = {
    ready: palette.primary,
    running: palette.active,
    delayed: palette.warning,
    failed: palette.danger,
  };
  const totals = queues.map((q) => q.ready + q.running + q.delayed + q.failed);
  const max = Math.max(1, ...totals);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Space spacing={16} wrap style={{ marginBottom: 2 }}>
        {QUEUE_SEGMENTS.map((seg) => (
          <Space key={seg.key} spacing={4} align="center">
            <span style={{ width: 8, height: 8, borderRadius: 2, background: segColor[seg.key], display: 'inline-block' }} />
            <Typography.Text type="tertiary" size="small">{seg.label}</Typography.Text>
          </Space>
        ))}
      </Space>
      {queues.map((q, i) => {
        const total = totals[i];
        return (
          <div key={q.key} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ width: 132, minWidth: 132, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor(palette, q.status), display: 'inline-block', flex: '0 0 auto' }} />
              <Typography.Text size="small" ellipsis={{ showTooltip: true }}>{q.name}</Typography.Text>
            </div>
            <div style={{ flex: 1, minWidth: 120, height: 16, borderRadius: 4, background: 'var(--semi-color-fill-0)', display: 'flex', overflow: 'hidden' }}>
              {QUEUE_SEGMENTS.map((seg) => {
                const v = q[seg.key];
                if (!v) return null;
                return (
                  <div
                    key={seg.key}
                    title={`${seg.label}: ${v}`}
                    style={{ width: `${(v / max) * 100}%`, minWidth: 3, background: segColor[seg.key] }}
                  />
                );
              })}
            </div>
            <div style={{ width: 170, minWidth: 150, textAlign: 'right' }}>
              <Typography.Text size="small" strong>{total}</Typography.Text>
              <Typography.Text type="tertiary" size="small">  · 最老 {formatAge(q.oldestAgeMinutes)}</Typography.Text>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function componentHealthItem(component: WorkflowEngineComponent, palette: ChartPalette) {
  const color = statusColor(palette, component.status);
  const abnormal = component.status !== 'healthy';
  return (
    <List.Item
      key={component.key}
      align="center"
      style={{ padding: '10px 4px' }}
      header={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 208, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: '0 0 auto' }} />
          {renderComponentIcon(component, color)}
          <Tooltip content={component.description} position="top">
            <Typography.Text strong ellipsis={{ showTooltip: false }} style={{ flex: 1, minWidth: 0 }}>{component.name}</Typography.Text>
          </Tooltip>
        </div>
      )}
      main={(
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', rowGap: 2, minWidth: 0 }}>
          {component.metrics.map((m, index) => {
            const abnormalMetric = m.status === 'critical' || m.status === 'warning';
            const mColor = m.status === 'critical' ? palette.danger : m.status === 'warning' ? palette.warning : undefined;
            const mBg = m.status === 'critical'
              ? 'var(--semi-color-danger-light-default)'
              : 'var(--semi-color-warning-light-default)';
            return (
              <span key={`${m.label}-${m.value}`} style={{ display: 'inline-flex', alignItems: 'baseline' }}>
                {index > 0 && <span aria-hidden style={{ color: palette.text2, opacity: 0.5, margin: '0 10px' }}>·</span>}
                <Typography.Text type="tertiary" size="small">{m.label}</Typography.Text>
                <Typography.Text
                  size="small"
                  strong
                  style={{
                    color: mColor,
                    marginLeft: 4,
                    ...(abnormalMetric ? { padding: '0 6px', borderRadius: 4, background: mBg } : null),
                  }}
                >
                  {m.unit ? `${m.value}${m.unit}` : m.value}
                </Typography.Text>
              </span>
            );
          })}
        </div>
      )}
      extra={abnormal ? statusTag(component.status) : undefined}
    />
  );
}

function IssuesPanel({ issues, components, onOpenInstanceDiagnostics }: Readonly<{ issues: WorkflowEngineRuntimeIssue[]; components: WorkflowEngineComponent[]; onOpenInstanceDiagnostics?: (instanceId: number) => void }>) {
  if (issues.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 4px' }}>
        <CheckCircle2 size={16} color="var(--semi-color-success)" />
        <Typography.Text type="tertiary">未发现运行时问题，引擎各子系统运行正常。</Typography.Text>
      </div>
    );
  }
  const componentName = (key: string) => components.find((item) => item.key === key)?.name ?? key;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 360, overflow: 'auto' }}>
      {issues.map((issue) => {
        const canDeepLink = issue.refType === 'instance' && issue.refId != null && onOpenInstanceDiagnostics;
        return (
          <div key={issue.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 4px', borderTop: '1px solid var(--semi-color-border)' }}>
            <div style={{ width: 60, flex: '0 0 auto' }}>{issueTag(issue.severity)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{issue.title}</Typography.Text>
              <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>{issue.description}</Typography.Text>
            </div>
            <div style={{ width: 170, flex: '0 0 auto', textAlign: 'right' }}>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>{componentName(issue.component)}</Typography.Text>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                <Typography.Text type="tertiary" size="small">
                  {issue.refType ? `${REF_TYPE_LABEL[issue.refType]}${issue.refId != null ? ` #${issue.refId}` : ''}` : ''}
                  {issue.ageMinutes != null ? ` · ${formatAge(issue.ageMinutes)}` : ''}
                </Typography.Text>
                {canDeepLink && (
                  <Button theme="borderless" size="small" icon={<Stethoscope size={13} />} onClick={() => onOpenInstanceDiagnostics?.(issue.refId as number)}>诊断</Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function downloadBlob(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorkflowEngineDiagnosticsView({ onOpenInstanceDiagnostics }: Props) {
  const palette = useChartPalette();
  const [thresholdMinutes, setThresholdMinutes] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(0);
  const [historyHours, setHistoryHours] = useState(24);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WorkflowEngineIntrospection | null>(null);
  const [history, setHistory] = useState<WorkflowEngineHealthHistory | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [actionLoading, setActionLoading] = useState<WorkflowEngineActionKey | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [res, hist] = await Promise.all([
        request.get<WorkflowEngineIntrospection>(`/api/workflows/engine/introspection?thresholdMinutes=${thresholdMinutes}`),
        request.get<WorkflowEngineHealthHistory>(`/api/workflows/engine/health-history?hours=${historyHours}`),
      ]);
      if (res.code === 0) setData(res.data);
      if (hist.code === 0) setHistory(hist.data);
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [thresholdMinutes, historyHours]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // 自动刷新
  useEffect(() => {
    if (autoRefresh <= 0) return;
    const id = window.setInterval(() => { void fetchData(); }, autoRefresh * 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh, fetchData]);

  // 「更新于 Xs 前」每秒滴答
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [batchRecoveryVisible, setBatchRecoveryVisible] = useState(false);

  // 运维动作：筛选 + 预览 + 执行（参考作业账本「条件重放」）
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [actionModal, setActionModal] = useState<{ key: WorkflowEngineActionKey; label: string } | null>(null);
  const [actionFilter, setActionFilter] = useState<{ instanceId?: number; olderThanMinutes?: number; limit: number }>({ limit: 200 });
  const [actionFormKey, setActionFormKey] = useState(0);
  const [actionPreview, setActionPreview] = useState<WorkflowEngineActionPreview | null>(null);
  const [actionPreviewLoading, setActionPreviewLoading] = useState(false);

  const openActionModal = useCallback((key: WorkflowEngineActionKey, label: string) => {
    setActionMenuVisible(false);
    setActionModal({ key, label });
    setActionFilter({ limit: 200 });
    setActionPreview(null);
    setActionFormKey((k) => k + 1);
  }, []);

  const previewAction = useCallback(async (key: WorkflowEngineActionKey, filter: { instanceId?: number; olderThanMinutes?: number; limit: number }) => {
    setActionPreviewLoading(true);
    try {
      const res = await request.post<WorkflowEngineActionPreview>(`/api/workflows/engine/actions/${key}/preview`, {
        instanceId: filter.instanceId,
        olderThanMinutes: filter.olderThanMinutes,
        limit: filter.limit,
      });
      if (res.code === 0 && res.data) setActionPreview(res.data);
    } catch {
      Toast.error('预览失败');
    } finally {
      setActionPreviewLoading(false);
    }
  }, []);

  const confirmAction = useCallback(async () => {
    if (!actionModal) return;
    setActionLoading(actionModal.key);
    try {
      const res = await request.post<WorkflowEngineActionResult>(`/api/workflows/engine/actions/${actionModal.key}`, {
        instanceId: actionFilter.instanceId,
        olderThanMinutes: actionFilter.olderThanMinutes,
        limit: actionFilter.limit,
      });
      if (res.code === 0 && res.data?.ok) {
        Toast.success({ content: res.data.message, duration: 4 });
      } else {
        Toast.warning({ content: res.data?.message || `${actionModal.label}未成功`, duration: 4 });
      }
      setActionModal(null);
      await fetchData();
    } catch {
      Toast.error(`${actionModal.label}执行失败`);
    } finally {
      setActionLoading(null);
    }
  }, [actionModal, actionFilter, fetchData]);

  const exportReport = useCallback(() => {
    if (!data) return;
    const stamp = (data.generatedAt || formatDateTime(new Date())).replace(/[: ]/g, '-');
    downloadBlob(`engine-diagnostics-${stamp}.json`, JSON.stringify({ introspection: data, history }, null, 2), 'application/json');
  }, [data, history]);

  const criticalCount = useMemo(() => data?.issues.filter((item) => item.severity === 'critical').length ?? 0, [data]);
  const warningCount = useMemo(() => data?.issues.filter((item) => item.severity === 'warning').length ?? 0, [data]);

  const nodeTypeRows = useMemo(() => (
    Object.entries(data?.definitions.nodeTypeCounts ?? {}).map(([type, count]) => ({
      type,
      label: NODE_TYPE_LABEL[type] ?? type,
      count,
    }))
  ), [data]);

  const eventTrendSpec = useMemo(() => makeAreaSpec({
    data: data?.telemetry.events.series24h ?? [],
    xField: 'hour',
    series: [
      { field: 'success', name: '成功', color: palette.success },
      { field: 'failed', name: '失败', color: palette.danger },
    ],
    palette,
    legend: true,
    axis: { xLabel: hourLabel },
    tooltip: { title: hourTooltip },
  }), [data?.telemetry.events.series24h, palette]);

  const instanceTrendSpec = useMemo(() => makeLineSpec({
    data: data?.telemetry.instances.series24h ?? [],
    xField: 'hour',
    series: [
      { field: 'created', name: '发起', color: palette.primary },
      { field: 'completed', name: '完结', color: palette.success },
    ],
    palette,
    legend: true,
    point: false,
    axis: { xLabel: hourLabel },
    tooltip: { title: hourTooltip },
  }), [data?.telemetry.instances.series24h, palette]);

  const historySpec = useMemo(() => makeLineSpec({
    data: history?.points ?? [],
    xField: 'capturedAt',
    series: [{ field: 'healthScore', name: '健康分', color: palette.primary }],
    palette,
    legend: false,
    point: false,
    axis: { xLabel: hourLabel, yLabel: (v) => `${v}` },
    tooltip: { title: hourTooltip, value: (v) => `${v} 分` },
  }), [history?.points, palette]);

  const backlogSpec = useMemo(() => makeAreaSpec({
    data: history?.points ?? [],
    xField: 'capturedAt',
    series: [{ field: 'backlog', name: '积压', color: palette.warning }],
    palette,
    legend: false,
    point: false,
    fillOpacity: 0.18,
    axis: { xLabel: hourLabel },
    tooltip: { title: hourTooltip, value: (v) => `${v} 项` },
  }), [history?.points, palette]);

  const sortedComponents = useMemo(() => (
    [...(data?.components ?? [])].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])
  ), [data]);

  const componentHealth = useMemo(() => {
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    for (const c of data?.components ?? []) {
      if (c.status === 'critical') critical += 1;
      else if (c.status === 'warning') warning += 1;
      else healthy += 1;
    }
    return { healthy, warning, critical };
  }, [data]);

  const taskRows = useMemo(() => (
    data?.runtime.taskQueue.map((item) => ({ ...item, rowId: `${item.queue}-${item.taskId}` })) ?? []
  ), [data]);

  const taskColumns: ColumnProps<WorkflowEngineRuntimeTask>[] = [
    { title: '队列', dataIndex: 'queue', width: 120, render: (value) => <Tag color="blue">{QUEUE_LABEL[value as WorkflowEngineQueueKey]}</Tag> },
    { title: 'Task ID', dataIndex: 'taskId', width: 90 },
    {
      title: '实例',
      dataIndex: 'instanceTitle',
      width: 300,
      render: (_value, record) => (
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong ellipsis={{ showTooltip: true }}>{record.instanceTitle}</Typography.Text>
            <div><Typography.Text type="tertiary" size="small">{record.serialNo ?? `#${record.instanceId}`}</Typography.Text></div>
          </div>
          {onOpenInstanceDiagnostics && (
            <Button theme="borderless" size="small" icon={<Stethoscope size={13} />} onClick={() => onOpenInstanceDiagnostics(record.instanceId)} />
          )}
        </div>
      ),
    },
    { title: '节点', dataIndex: 'nodeName', width: 180, render: (_value, record) => `${record.nodeName || record.nodeKey}${record.nodeType ? ` / ${NODE_TYPE_LABEL[record.nodeType] ?? record.nodeType}` : ''}` },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, 'grey') },
    { title: '处理人', dataIndex: 'assigneeName', width: 110, render: (value) => value || '—' },
    { title: '触发器', dataIndex: 'triggerDispatchStatus', width: 110, render: (value) => rawTag(value as string | null, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'grey') },
    { title: '外部审批', dataIndex: 'externalDispatchStatus', width: 110, render: (value) => rawTag(value as string | null, value === 'failed' ? 'red' : 'grey') },
    { title: 'timeoutAt', dataIndex: 'timeoutAt', width: 170, render: (value) => value || '—' },
    { title: 'wakeAt', dataIndex: 'wakeAt', width: 170, render: (value) => value || '—' },
    { title: '年龄', dataIndex: 'ageMinutes', width: 110, render: (value) => formatAge(value as number | null) },
  ];

  const triggerColumns: ColumnProps<WorkflowEngineTriggerExecution>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '实例', dataIndex: 'instanceTitle', width: 260, render: (value, record) => value || `#${record.instanceId}` },
    { title: '节点', dataIndex: 'nodeName', width: 160, render: (value, record) => value || record.nodeKey },
    { title: '类型', dataIndex: 'triggerType', width: 120 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'blue') },
    { title: '尝试', dataIndex: 'attempt', width: 80 },
    { title: '耗时', dataIndex: 'durationMs', width: 100, render: (value) => value == null ? '—' : `${value}ms` },
    { title: '错误', dataIndex: 'errorMessage', width: 260, render: (value) => value || '—' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
  ];

  const outboxColumns: ColumnProps<WorkflowEngineOutboxEvent>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '事件', dataIndex: 'eventType', width: 180 },
    { title: '实例', dataIndex: 'instanceTitle', width: 260, render: (value, record) => value || (record.instanceId != null ? `#${record.instanceId}` : '—') },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'failed' ? 'red' : value === 'retrying' ? 'orange' : 'blue') },
    { title: '尝试', dataIndex: 'attempts', width: 80 },
    { title: '下次重试', dataIndex: 'nextRetryAt', width: 170, render: (value) => value || '—' },
    { title: '错误', dataIndex: 'errorMessage', width: 260, render: (value) => value || '—' },
    { title: '年龄', dataIndex: 'ageMinutes', width: 110, render: (value) => formatAge(value as number | null) },
  ];

  const invalidDefinitionColumns: ColumnProps<WorkflowEngineDefinitionValidationItem>[] = [
    { title: '定义 ID', dataIndex: 'definitionId', width: 100 },
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '状态', dataIndex: 'status', width: 100, render: (value) => rawTag(value as string, value === 'published' ? 'green' : 'grey') },
    { title: '版本', dataIndex: 'version', width: 80 },
    { title: '错误', dataIndex: 'errors', render: (value) => (Array.isArray(value) ? value.join('；') : '—') },
  ];

  const nodeTypeColumns: ColumnProps<{ type: string; label: string; count: number }>[] = [
    { title: '节点类型', dataIndex: 'label', width: 160 },
    { title: 'Key', dataIndex: 'type', width: 180 },
    { title: '数量', dataIndex: 'count', width: 100 },
  ];

  const listenerColumns: ColumnProps<WorkflowEngineIntrospection['eventBus']['listeners'][number]>[] = [
    { title: '事件类型', dataIndex: 'eventType' },
    { title: '监听器数', dataIndex: 'listenerCount', width: 120 },
  ];

  const recurringJobColumns: ColumnProps<WorkflowEngineIntrospection['telemetry']['recurringJobs'][number]>[] = [
    { title: '任务名', dataIndex: 'name' },
    { title: 'Cron', dataIndex: 'cronExpression', width: 150 },
    { title: '下次执行', dataIndex: 'nextRunAt', width: 180, render: (value) => value || '—' },
    { title: '注册时间', dataIndex: 'registeredAt', width: 180 },
  ];

  const queueWorkerColumns: ColumnProps<WorkflowEngineIntrospection['scheduler']['systemQueueWorkers'][number]>[] = [
    { title: 'Worker', dataIndex: 'name' },
    { title: '注册时间', dataIndex: 'registeredAt', width: 180 },
  ];

  const wipColumns: ColumnProps<WorkflowEngineIntrospection['scheduler']['wip'][number]>[] = [
    { title: '队列', dataIndex: 'name' },
    { title: '运行中', dataIndex: 'count', width: 100 },
  ];

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton loading placeholder={<Skeleton.Paragraph rows={2} style={{ width: '100%' }} />} active />
        <Card bordered bodyStyle={{ padding: 16 }} style={{ borderRadius: 8 }}>
          <Skeleton loading placeholder={<Skeleton.Paragraph rows={4} style={{ width: '100%' }} />} active />
        </Card>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card bordered style={{ borderRadius: 8, flex: '1 1 380px' }}><Skeleton loading placeholder={<Skeleton.Image style={{ width: '100%', height: 150 }} />} active /></Card>
          <Card bordered style={{ borderRadius: 8, flex: '1 1 380px' }}><Skeleton loading placeholder={<Skeleton.Image style={{ width: '100%', height: 150 }} />} active /></Card>
        </div>
      </div>
    );
  }

  if (!data) {
    return <Empty description="暂无引擎内省数据" />;
  }

  const actionSampleColumns: ColumnProps<WorkflowEngineActionSampleJob>[] = [
    { title: 'ID', dataIndex: 'id', width: 84 },
    { title: '类型', dataIndex: 'jobType', width: 116, render: (v: string) => JOB_TYPE_LABEL[v] ?? v },
    {
      title: '状态', dataIndex: 'status', width: 84,
      render: (v: string) => { const m = JOB_STATUS_META[v]; return m ? <Tag color={m.color}>{m.text}</Tag> : <Tag>{v}</Tag>; },
    },
    { title: '实例', dataIndex: 'instanceId', width: 88, render: (v: number | null) => (v != null ? `#${v}` : '—') },
    { title: '尝试', dataIndex: 'attempts', width: 64 },
    { title: '到期时间', dataIndex: 'runAt', width: 164 },
    {
      title: '最近错误', dataIndex: 'lastError',
      render: (v: string | null) => (v ? <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v}</Typography.Text> : <Typography.Text type="tertiary">—</Typography.Text>),
    },
  ];

  const t = data.telemetry;
  const errorRate = t.events.last24h.total > 0 ? (t.events.last24h.failed / t.events.last24h.total) * 100 : 0;
  const prevErrorRate = t.events.prev24h.total > 0 ? (t.events.prev24h.failed / t.events.prev24h.total) * 100 : 0;
  const errorAccent = (t.triggers.last24h.failed > 0 || errorRate >= 5)
    ? palette.danger
    : (t.events.last24h.failed > 0 || t.triggers.last24h.retrying > 0)
      ? palette.warning
      : undefined;
  const backlog = data.queues.reduce((sum, q) => sum + q.ready + q.running + q.delayed + q.failed, 0);
  const oldestBacklog = data.queues.reduce<number | null>((acc, q) => (q.oldestAgeMinutes != null ? Math.max(acc ?? 0, q.oldestAgeMinutes) : acc), null);
  const worstQueueRank = data.queues.reduce((acc, q) => Math.max(acc, STATUS_RANK[q.status]), 0);
  const saturationAccent = backlog >= data.thresholds.backlogCritical || worstQueueRank >= 2
    ? palette.danger
    : backlog >= data.thresholds.backlogWarn || worstQueueRank >= 1
      ? palette.warning
      : undefined;
  const stuckInstances = data.runtime.runningWithoutActiveTasks.length;
  const freshnessSec = lastUpdated ? Math.max(0, Math.round((nowTick - lastUpdated) / 1000)) : null;
  const freshnessText = freshnessSec == null ? '' : freshnessSec < 60 ? `${freshnessSec}s 前` : `${Math.floor(freshnessSec / 60)}m 前`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 命令栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            height: 32,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid var(--semi-color-border)',
            background: data.healthy ? 'var(--semi-color-success-light-default)' : 'var(--semi-color-danger-light-default)',
          }}
        >
          {data.healthy ? <CheckCircle2 size={16} color="var(--semi-color-success)" /> : <AlertTriangle size={16} color="var(--semi-color-danger)" />}
          <Typography.Text strong>{data.healthy ? '引擎状态正常' : '引擎存在严重事项'}</Typography.Text>
          <Typography.Text type="tertiary" size="small">· {data.generatedAt} 生成{freshnessText ? ` · 更新于 ${freshnessText}` : ''}</Typography.Text>
        </div>
        <Space wrap align="center">
          <Dropdown
            trigger="click"
            position="bottomRight"
            visible={actionMenuVisible}
            onVisibleChange={setActionMenuVisible}
            render={(
              <Dropdown.Menu>
                {ACTION_ITEMS.map((item) => (
                  <Dropdown.Item key={item.key} disabled={actionLoading != null} onClick={() => openActionModal(item.key, item.label)}>
                    {item.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            )}
          >
            <Button icon={<Wrench size={14} />} loading={actionLoading != null}>运维动作</Button>
          </Dropdown>
          <Button icon={<LifeBuoy size={14} />} onClick={() => setBatchRecoveryVisible(true)}>批量恢复</Button>
          <Button icon={<Download size={14} />} onClick={exportReport}>导出</Button>
          <Select value={autoRefresh} optionList={AUTO_REFRESH_OPTIONS} style={{ width: 116 }} onChange={(v) => setAutoRefresh(Number(v))} />
          <Select value={thresholdMinutes} optionList={THRESHOLD_OPTIONS} style={{ width: 116 }} onChange={(value) => setThresholdMinutes(Number(value))} />
          <Button type="primary" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void fetchData()}>刷新</Button>
        </Space>
      </div>

      <WorkflowBatchRecoveryModal visible={batchRecoveryVisible} onClose={() => setBatchRecoveryVisible(false)} />

      {actionModal && (
        <Modal
          title={`${actionModal.label} · 条件执行`}
          visible
          onCancel={() => setActionModal(null)}
          okText="确认执行"
          cancelText="取消"
          onOk={() => void confirmAction()}
          okButtonProps={{ loading: actionLoading === actionModal.key, type: 'warning' }}
          width={760}
        >
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            先按条件筛选并预览将被处理的作业（到期待处理 + 卡死回收），确认后再执行。
            {actionPreview && actionPreview.jobTypes.length > 0 && (
              <> 作业类型：{actionPreview.jobTypes.map((jt) => JOB_TYPE_LABEL[jt] ?? jt).join(' / ')}。</>
            )}
          </Typography.Text>
          <Form
            key={actionFormKey}
            labelPosition="left"
            labelWidth={96}
            initValues={actionFilter}
            onValueChange={(values) => {
              setActionFilter((s) => ({
                instanceId: typeof values.instanceId === 'number' ? values.instanceId : undefined,
                olderThanMinutes: typeof values.olderThanMinutes === 'number' ? values.olderThanMinutes : undefined,
                limit: typeof values.limit === 'number' ? values.limit : s.limit,
              }));
              setActionPreview(null);
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="instanceId" label="实例 ID" placeholder="不限" min={1} style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="olderThanMinutes" label="入库超过" placeholder="不限" min={0} suffix="分钟" style={{ width: '100%' }} />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="limit" label="单次上限" min={1} max={500} suffix="条" style={{ width: '100%' }} />
              </Col>
            </Row>
          </Form>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '4px 0 12px' }}>
            <Button size="small" theme="light" loading={actionPreviewLoading} onClick={() => void previewAction(actionModal.key, actionFilter)}>预览数据</Button>
            {actionPreview && (
              <Typography.Text type="tertiary" size="small">
                将处理 <b>{Math.min(actionPreview.matched, actionPreview.limit)}</b> / 匹配 {actionPreview.matched} 条
                （到期 {actionPreview.duePending} · 卡死 {actionPreview.stuckRunning}）
                {actionPreview.scheduledLater > 0 && ` · 未到期 ${actionPreview.scheduledLater}`}
                {actionPreview.matched > actionPreview.limit && '（超上限部分需再次执行）'}
              </Typography.Text>
            )}
          </div>
          {actionPreview && (
            actionPreview.sample.length > 0 ? (
              <ConfigurableTable<WorkflowEngineActionSampleJob>
                bordered
                columnSettings={false}
                size="small"
                columns={actionSampleColumns}
                dataSource={actionPreview.sample}
                rowKey="id"
                pagination={false}
                scroll={{ y: 260 }}
              />
            ) : (
              <Empty description="按当前条件没有待处理的作业" style={{ padding: 16 }} />
            )
          )}
        </Modal>
      )}

      {/* 概览 Hero：健康分 + 黄金信号 */}
      <Card bordered bodyStyle={{ padding: 16 }} style={{ borderRadius: 8 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <Popover content={<ScoreBreakdown data={data} palette={palette} />} position="rightTop" showArrow>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: 188, cursor: 'help' }}>
              <HealthRadial score={t.healthScore} palette={palette} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 18px', width: '100%' }}>
                <MicroStat label="严重事项" value={criticalCount} color={criticalCount > 0 ? palette.danger : undefined} />
                <MicroStat label="警告事项" value={warningCount} color={warningCount > 0 ? palette.warning : undefined} />
                <MicroStat label="运行实例" value={data.runtime.runningInstances} />
                <MicroStat label="事件监听器" value={data.eventBus.totalListenerCount} />
              </div>
            </div>
          </Popover>
          <div style={{ flex: '1 1 520px', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <GoldenTile
              icon={<TrendingUp size={15} color="var(--semi-color-primary)" />}
              label="吞吐 · Traffic"
              value={t.events.last24h.total}
              delta={<DeltaChip current={t.events.last24h.total} prev={t.events.prev24h.total} palette={palette} />}
              sub={`近 1h ${t.events.last1h.total} · 实例发起 ${t.instances.createdLast24h}`}
            />
            <GoldenTile
              icon={<AlertTriangle size={15} color={errorAccent ?? 'var(--semi-color-text-2)'} />}
              label="错误 · Errors"
              value={`${errorRate.toFixed(1)}%`}
              accent={errorAccent}
              delta={<DeltaChip current={errorRate} prev={prevErrorRate} invert palette={palette} suffix="pp" />}
              sub={`事件失败 ${t.events.last24h.failed} · 触发失败 ${t.triggers.last24h.failed} · 重试 ${t.triggers.last24h.retrying}`}
            />
            <GoldenTile
              icon={<Timer size={15} color="var(--semi-color-primary)" />}
              label="延迟 · Latency"
              value={formatMs(t.events.avgLatencyMs)}
              sub={`P95 ${formatMs(t.events.p95LatencyMs)} · P99 ${formatMs(t.events.p99LatencyMs)} · Apdex ${t.apdex.score != null ? t.apdex.score.toFixed(2) : '—'}`}
            />
            <GoldenTile
              icon={<Layers size={15} color={saturationAccent ?? 'var(--semi-color-text-2)'} />}
              label="饱和度 · Saturation"
              value={backlog}
              accent={saturationAccent}
              sub={`最老 ${formatAge(oldestBacklog)} · 待重放 ${t.events.pendingRetry} · 无任务实例 ${stuckInstances}`}
            />
          </div>
        </div>
      </Card>

      {/* 趋势：事件吞吐 + 实例生命周期 */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8, flex: '1 1 380px', minWidth: 300 }}>
          <SectionTitle icon={<Zap size={16} color="var(--semi-color-primary)" />} title="事件吞吐趋势" desc="近 24h 成功 / 失败（按小时）" />
          <AreaChart {...eventTrendSpec} options={chartOptions} height={150} />
        </Card>
        <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8, flex: '1 1 380px', minWidth: 300 }}>
          <SectionTitle icon={<Workflow size={16} color="var(--semi-color-primary)" />} title="实例生命周期趋势" desc="近 24h 发起 / 完结（按小时）" />
          <LineChart {...instanceTrendSpec} options={chartOptions} height={150} />
        </Card>
      </div>

      {/* 健康趋势历史 */}
      <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8 }}>
        <SectionTitle
          icon={<GaugeCircle size={16} color="var(--semi-color-primary)" />}
          title="健康趋势"
          desc="健康分与队列积压随时间变化（平台级采集）"
          extra={<Select value={historyHours} optionList={HISTORY_RANGE_OPTIONS} style={{ width: 128 }} size="small" onChange={(v) => setHistoryHours(Number(v))} />}
        />
        {history && history.points.length > 0 ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 380px', minWidth: 300 }}>
              <Typography.Text type="tertiary" size="small">健康分（0-100）</Typography.Text>
              <LineChart {...historySpec} options={chartOptions} height={150} />
            </div>
            <div style={{ flex: '1 1 380px', minWidth: 300 }}>
              <Typography.Text type="tertiary" size="small">队列积压</Typography.Text>
              <AreaChart {...backlogSpec} options={chartOptions} height={150} />
            </div>
          </div>
        ) : (
          <Empty description="暂无健康历史，定时采集任务运行后将逐步生成趋势" style={{ padding: 24 }} />
        )}
      </Card>

      {/* 活动问题 */}
      <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8 }}>
        <SectionTitle
          icon={<AlertTriangle size={16} color={data.issues.length > 0 ? 'var(--semi-color-warning)' : 'var(--semi-color-success)'} />}
          title="活动问题"
          desc={data.issues.length > 0 ? `严重 ${criticalCount} · 警告 ${warningCount}` : '运行时巡检'}
          extra={<Tag color={criticalCount > 0 ? 'red' : warningCount > 0 ? 'orange' : 'green'}>{data.issues.length}</Tag>}
        />
        <IssuesPanel issues={data.issues} components={data.components} onOpenInstanceDiagnostics={onOpenInstanceDiagnostics} />
      </Card>

      {/* 队列饱和度 */}
      <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8 }}>
        <SectionTitle icon={<Layers size={16} color="var(--semi-color-primary)" />} title="队列饱和度" desc="各内部队列积压构成与最老等待" extra={<Typography.Text type="tertiary" size="small">总积压 {backlog} · 阈值 {data.thresholds.backlogWarn}/{data.thresholds.backlogCritical}</Typography.Text>} />
        <QueueSaturation queues={data.queues} palette={palette} />
      </Card>

      {/* 延迟分布 + Apdex */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8, flex: '1 1 360px', minWidth: 300 }}>
          <SectionTitle icon={<Timer size={16} color="var(--semi-color-primary)" />} title="事件处理延迟分布" desc={`P95 ${formatMs(t.events.p95LatencyMs)} · P99 ${formatMs(t.events.p99LatencyMs)}`} />
          <HistogramBars buckets={t.events.latencyHistogram} color={palette.primary} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--semi-color-border)' }}>
            <ApdexBar data={data} palette={palette} />
          </div>
        </Card>
        <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8, flex: '1 1 360px', minWidth: 300 }}>
          <SectionTitle icon={<Zap size={16} color="var(--semi-color-primary)" />} title="触发器耗时分布" desc={`均值 ${formatMs(t.triggers.avgDurationMs)} · P95 ${formatMs(t.triggers.p95DurationMs)} · P99 ${formatMs(t.triggers.p99DurationMs)}`} />
          <HistogramBars buckets={t.triggers.durationHistogram} color={palette.active} />
        </Card>
      </div>

      {/* 组件健康矩阵 */}
      <Card bordered bodyStyle={{ padding: 14 }} style={{ borderRadius: 8 }}>
        <SectionTitle
          icon={<GaugeCircle size={16} color="var(--semi-color-primary)" />}
          title="组件健康矩阵"
          desc="引擎子系统状态（严重优先）"
          extra={(
            <Space spacing={12}>
              <Typography.Text size="small" style={{ color: palette.success }}>正常 {componentHealth.healthy}</Typography.Text>
              {componentHealth.warning > 0 && <Typography.Text size="small" style={{ color: palette.warning }}>关注 {componentHealth.warning}</Typography.Text>}
              {componentHealth.critical > 0 && <Typography.Text size="small" style={{ color: palette.danger }}>严重 {componentHealth.critical}</Typography.Text>}
            </Space>
          )}
        />
        <List
          dataSource={sortedComponents}
          size="small"
          renderItem={(component) => componentHealthItem(component, palette)}
        />
      </Card>

      {/* 运行时明细 */}
      <Tabs type="line">
        <TabPane tab={`队列任务 ${data.runtime.taskQueue.length}`} itemKey="tasks">
          <ConfigurableTable<WorkflowEngineRuntimeTask>
            bordered
            columnSettings={false}
            columns={taskColumns}
            dataSource={taskRows}
            rowKey="rowId"
            pagination={false}
            empty="暂无内部队列任务"
            scroll={{ x: 1540 }}
          />
        </TabPane>
        <TabPane tab={`事件派发 ${data.runtime.outboxEvents.length}`} itemKey="outbox">
          <ConfigurableTable<WorkflowEngineOutboxEvent>
            bordered
            columnSettings={false}
            columns={outboxColumns}
            dataSource={data.runtime.outboxEvents}
            rowKey="id"
            pagination={false}
            empty="暂无待处理事件派发"
            scroll={{ x: 1230 }}
          />
        </TabPane>
        <TabPane tab={`触发器 ${data.runtime.triggerExecutions.length}`} itemKey="triggers">
          <ConfigurableTable<WorkflowEngineTriggerExecution>
            bordered
            columnSettings={false}
            columns={triggerColumns}
            dataSource={data.runtime.triggerExecutions}
            rowKey="id"
            pagination={false}
            empty="暂无异常触发器执行"
            scroll={{ x: 1330 }}
          />
        </TabPane>
        <TabPane tab="定义校验" itemKey="definitions">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 12 }}>
            <ConfigurableTable<WorkflowEngineDefinitionValidationItem>
              bordered
              columnSettings={false}
              columns={invalidDefinitionColumns}
              dataSource={data.definitions.invalidDefinitions}
              rowKey="definitionId"
              pagination={false}
              empty="流程定义均通过当前引擎校验"
              scroll={{ x: 820 }}
            />
            <ConfigurableTable<{ type: string; label: string; count: number }>
              bordered
              columnSettings={false}
              columns={nodeTypeColumns}
              dataSource={nodeTypeRows}
              rowKey="type"
              pagination={false}
              empty="暂无节点统计"
              scroll={{ x: 440 }}
            />
          </div>
        </TabPane>
        <TabPane tab="事件与调度" itemKey="scheduler">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={listenerColumns}
              dataSource={data.eventBus.listeners}
              rowKey="eventType"
              pagination={false}
              empty="暂无事件监听器"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={recurringJobColumns}
              dataSource={data.telemetry.recurringJobs}
              rowKey="name"
              pagination={false}
              empty="暂无系统周期任务"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={queueWorkerColumns}
              dataSource={data.scheduler.systemQueueWorkers}
              rowKey="name"
              pagination={false}
              empty="暂无系统队列 Worker"
            />
            <ConfigurableTable
              bordered
              columnSettings={false}
              columns={wipColumns}
              dataSource={data.scheduler.wip}
              rowKey="name"
              pagination={false}
              empty="暂无运行中 Job"
            />
          </div>
        </TabPane>
        <TabPane tab="原始快照" itemKey="raw">
          {renderJsonBlock(data)}
        </TabPane>
      </Tabs>
    </div>
  );
}
