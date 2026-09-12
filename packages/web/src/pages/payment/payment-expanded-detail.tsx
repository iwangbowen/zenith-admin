/**
 * 支付日志 / 事件列表的行内展开详情：顶部一行弱化的标识文案（内部 ID 等），随后若干「小标题 + 内容」区块。
 * 容器声明 `flex: 1` + `minWidth: 0`——Semi 展开行容器是 flex row，不声明会被收缩成内容最小宽。
 */
import type { ReactNode } from 'react';
import { Typography } from '@douyinfe/semi-ui';

export interface ExpandedDetailSection {
  readonly title: string;
  readonly content: ReactNode;
  /** 为 false 时跳过该区块（如无错误信息 / 无请求头） */
  readonly visible?: boolean;
}

export function PaymentExpandedDetail({ meta, sections }: Readonly<{ meta?: ReactNode; sections: readonly ExpandedDetailSection[] }>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', flex: 1, minWidth: 0 }}>
      {meta !== undefined && <Typography.Text type="tertiary" size="small">{meta}</Typography.Text>}
      {sections.filter((section) => section.visible !== false).map((section) => (
        <div key={section.title}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>{section.title}</Typography.Text>
          {section.content}
        </div>
      ))}
    </div>
  );
}
