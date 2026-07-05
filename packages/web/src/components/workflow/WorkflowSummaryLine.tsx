/**
 * 列表摘要行：待办 / 我的申请列表在标题下展示流程配置的摘要字段值（钉钉式卡片摘要）
 */
import type { WorkflowInstanceSummaryItem } from '@zenith/shared';

export default function WorkflowSummaryLine({ items }: Readonly<{ items?: WorkflowInstanceSummaryItem[] | null }>) {
  if (!items || items.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 12,
        lineHeight: '18px',
        color: 'var(--semi-color-text-2)',
        marginTop: 2,
        minWidth: 0,
      }}
    >
      {items.map((it) => (
        <span key={it.key} style={{ display: 'inline-flex', gap: 4, minWidth: 0, maxWidth: 220 }}>
          <span style={{ flexShrink: 0 }}>{it.label}:</span>
          <span
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={it.value}
          >
            {it.value}
          </span>
        </span>
      ))}
    </div>
  );
}
