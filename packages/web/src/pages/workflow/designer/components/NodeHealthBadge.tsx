/**
 * NodeHealthBadge — 设计态画布上的节点体检角标。
 * 仅展示「严重」级问题（阻断发布）的红色角标；警告/提示级不在画布常驻，统一在「流程体检」查看。
 * hover 展示严重问题清单 + 修复建议。
 */
import { Popover, Tag, Typography } from '@douyinfe/semi-ui';
import { AlertTriangle } from 'lucide-react';
import type { NodeHealthInfo } from '../types';

export default function NodeHealthBadge({ health }: Readonly<{ health?: NodeHealthInfo }>) {
  if (!health || health.error === 0) return null;
  const criticalIssues = health.issues.filter((i) => i.severity === 'critical');
  const count = health.error;

  const content = (
    <div style={{ maxWidth: 280, padding: '4px 2px' }}>
      {criticalIssues.map((iss, idx) => (
        <div key={idx} style={{ padding: '4px 0', borderBottom: idx < criticalIssues.length - 1 ? '1px dashed var(--semi-color-border)' : undefined }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Tag size="small" color="red">严重</Tag>
            <div style={{ flex: 1 }}>
              <Typography.Text size="small">{iss.message}</Typography.Text>
              {iss.suggestion && (
                <Typography.Paragraph size="small" type="tertiary" style={{ margin: '2px 0 0' }}>建议：{iss.suggestion}</Typography.Paragraph>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Popover content={content} position="top" showArrow trigger="hover">
      <span
        role="none"
        className="fd-node-health-badge"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--semi-color-danger)', cursor: 'help' }}
        onClick={(e) => e.stopPropagation()}
      >
        <AlertTriangle size={13} />
        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1 }}>{count}</span>
      </span>
    </Popover>
  );
}
