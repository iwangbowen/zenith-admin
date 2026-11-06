import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ObservabilityStatus } from '@zenith/shared/platform';

const { Text } = Typography;

const STATUS_META: Record<ObservabilityStatus, { label: string; color: 'green' | 'orange' | 'red' }> = {
  ok: { label: '正常', color: 'green' },
  degraded: { label: '降级', color: 'orange' },
  unavailable: { label: '不可用', color: 'red' },
};

export function FreshnessBadge({ status, ageSeconds }: Readonly<{ status: ObservabilityStatus; ageSeconds: number | null }>) {
  const meta = STATUS_META[status];
  const age = ageSeconds === null ? '无数据' : ageSeconds < 1 ? '刚刚更新' : `${Math.round(ageSeconds)} 秒前更新`;
  return <Tag color={meta.color} size="small">{meta.label} · {age}</Tag>;
}

export function PartialDataBanner({ partial, unavailableSources }: Readonly<{ partial: boolean; unavailableSources: string[] }>) {
  if (!partial) return null;
  const detail = unavailableSources.length > 0 ? `需关注来源：${unavailableSources.join('、')}` : '部分观测源处于降级或过期状态';
  return <Text type="warning" size="small">{detail}。页面不会把缺失数据显示为 0。</Text>;
}
