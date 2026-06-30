/**
 * 审批时间线统一圆点：圆形浅色底 + 居中图标。
 * 供 ApprovalTimeline（运行态）与 WorkflowApprovalChainPanel（预测态）共用，保证两处视觉一致。
 */
import type { LucideIcon } from 'lucide-react';
import './timeline.css';

export function timelineDot(Icon: LucideIcon, iconColor: string) {
  return (
    <div style={{
      width: 28,
      height: 28,
      borderRadius: '50%',
      backgroundColor: `color-mix(in srgb, ${iconColor} 10%, transparent)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon size={15} color={iconColor} />
    </div>
  );
}
