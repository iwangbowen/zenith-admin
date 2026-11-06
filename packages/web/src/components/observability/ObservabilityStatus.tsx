import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ObservabilitySourceStatus, ObservabilityStatus } from '@zenith/shared/platform';

const { Text } = Typography;

type DisplayStatus = ObservabilityStatus | ObservabilitySourceStatus;

type StatusMeta = { label: string; color: 'green' | 'orange' | 'red' | 'grey' };

const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  ok: { label: '正常', color: 'green' },
  degraded: { label: '降级', color: 'orange' },
  stale: { label: '已过期', color: 'orange' },
  not_sampled: { label: '未采样', color: 'grey' },
  unavailable: { label: '不可用', color: 'red' },
};

export function FreshnessBadge({ status, ageSeconds }: Readonly<{ status: DisplayStatus; ageSeconds: number | null }>) {
  const meta = STATUS_META[status];
  const age = status === 'not_sampled'
    ? '尚未采样'
    : status === 'unavailable'
      ? '不可读取'
      : ageSeconds === null
        ? '无数据'
        : ageSeconds < 1
          ? '刚刚更新'
          : `${Math.round(ageSeconds)} 秒前更新`;
  return <Tag color={meta.color} size="small">{meta.label} · {age}</Tag>;
}

export function PartialDataBanner({ partial, unavailableSources }: Readonly<{ partial: boolean; unavailableSources: string[] }>) {
  if (!partial) return null;
  const detail = unavailableSources.length > 0 ? `需关注来源：${unavailableSources.join('、')}` : '部分观测源处于降级或过期状态';
  return <Text type="warning" size="small">{detail}。页面不会把缺失数据显示为 0。</Text>;
}
