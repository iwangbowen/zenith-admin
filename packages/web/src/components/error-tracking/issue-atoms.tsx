/**
 * 错误监控 / 异常日志共用的 Issue 展示组件：类型 / 级别 / 状态标签、类型图标、迷你趋势、代码块、告警渠道标签。
 * 颜色表与工具函数在 `issue-meta.ts`。
 */
import type { ReactNode } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';
import { AlertCircle, AlertTriangle, Bug, Clock, FileCode, ListChecks, MessageSquare, Radio, ScrollText, ServerCrash, Skull, Zap } from 'lucide-react';
import type { ErrorLevel, ErrorStatus, ErrorType } from '@zenith/shared/analytics';
import { ERROR_LEVEL_LABELS, ERROR_STATUS_LABELS, ERROR_TYPE_LABELS } from '@zenith/shared/analytics';
import { TextBlock } from '@/components/TextBlock';
import { ERROR_LEVEL_COLORS, ERROR_STATUS_COLORS, ERROR_TYPE_COLORS } from './issue-meta';

const { Text } = Typography;

export function ErrorTypeTag({ type }: Readonly<{ type: ErrorType }>) {
  return <Tag color={ERROR_TYPE_COLORS[type] ?? 'grey'}>{ERROR_TYPE_LABELS[type] ?? type}</Tag>;
}

export function ErrorLevelTag({ level }: Readonly<{ level: ErrorLevel }>) {
  return <Tag color={ERROR_LEVEL_COLORS[level] ?? 'grey'}>{ERROR_LEVEL_LABELS[level] ?? level}</Tag>;
}

export function ErrorStatusTag({ status }: Readonly<{ status: ErrorStatus }>) {
  return <Tag color={ERROR_STATUS_COLORS[status] ?? 'grey'}>{ERROR_STATUS_LABELS[status] ?? status}</Tag>;
}

export function ErrorTypeIcon({ type }: Readonly<{ type: ErrorType }>) {
  const common = { size: 15, style: { verticalAlign: 'middle' } };
  switch (type) {
    case 'white_screen': return <AlertTriangle {...common} />;
    case 'http_error': return <Zap {...common} />;
    case 'resource_error': return <FileCode {...common} />;
    case 'console_error': return <MessageSquare {...common} />;
    case 'crash': return <AlertCircle {...common} />;
    case 'server_exception': return <ServerCrash {...common} />;
    case 'job_failure': return <ListChecks {...common} />;
    case 'cron_failure': return <Clock {...common} />;
    case 'event_failure': return <Radio {...common} />;
    case 'process_crash': return <Skull {...common} />;
    case 'logged_error': return <ScrollText {...common} />;
    default: return <Bug {...common} />;
  }
}

/** 等宽只读文本块（堆栈 / JSON 上下文）；外观由共享的 TextBlock 提供，本页面不再自带样式 */
export function CodeBlock({ children, maxHeight = 280 }: Readonly<{ children: ReactNode; maxHeight?: number }>) {
  return <TextBlock maxHeight={maxHeight}>{children}</TextBlock>;
}

const SPARK_W = 96;
const SPARK_H = 26;

/** 表格内嵌迷你趋势曲线（近 7 日发生次数） */
export function TrendSparkline({ data }: Readonly<{ data?: readonly number[] }>) {
  if (!data || data.length < 2 || data.every((v) => v === 0)) {
    return <Text type="tertiary" size="small">–</Text>;
  }
  const max = Math.max(...data, 1);
  const stepX = SPARK_W / (data.length - 1);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(SPARK_H - 3 - (v / max) * (SPARK_H - 6)).toFixed(1)}`).join(' ');
  const rising = data[data.length - 1] > data[0];
  const color = rising ? 'var(--semi-color-danger)' : 'var(--semi-color-success)';
  return (
    <svg width={SPARK_W} height={SPARK_H} aria-label="近 7 日趋势">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}