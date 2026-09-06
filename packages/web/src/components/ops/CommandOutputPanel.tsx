import type { ReactNode, Ref } from 'react';
import { Tag, Typography } from '@douyinfe/semi-ui';

interface CommandOutputPanelProps {
  output: string;
  running?: boolean;
  runningText?: string;
  emptyText: ReactNode;
  preRef?: Ref<HTMLPreElement>;
  children?: ReactNode;
  header?: ReactNode;
  heightOffset?: number;
  fontSize?: number;
}

export function CommandOutputPanel({
  output,
  running = false,
  runningText = '● 运行中',
  emptyText,
  preRef,
  children,
  header,
  heightOffset = 32,
  fontSize = 13,
}: CommandOutputPanelProps) {
  return (
    <div style={{ flex: 1, minHeight: 0, borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden', border: '1px solid var(--semi-color-border)' }}>
      {header && (
        <div style={{ padding: '4px 12px', background: 'var(--semi-color-fill-1)', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text size="small" type="secondary">{header}</Typography.Text>
          {running && <Tag color="green" size="small">{runningText}</Tag>}
        </div>
      )}
      {children ?? (
        <pre ref={preRef} style={{
          margin: 0, padding: 12, fontFamily: 'Consolas, "Courier New", monospace', fontSize, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'var(--surface-card)',
          height: header ? `calc(100% - ${heightOffset}px)` : '100%', overflow: 'auto', color: 'var(--semi-color-text-0)',
        }}>
          {output || <Typography.Text type="tertiary" style={{ fontStyle: 'italic' }}>{emptyText}</Typography.Text>}
        </pre>
      )}
    </div>
  );
}
