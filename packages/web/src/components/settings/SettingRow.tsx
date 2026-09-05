import type { CSSProperties, ReactNode } from 'react';
import { Divider, Tag, Typography } from '@douyinfe/semi-ui';

const { Text, Title } = Typography;

export interface SettingRowProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control: ReactNode;
  /** 当前值来自本作用域的显式覆盖（与上级不同），标记「已覆盖」 */
  readonly overridden?: boolean;
  /** 覆盖标记右侧的附加操作（如「恢复继承」） */
  readonly extra?: ReactNode;
  readonly style?: CSSProperties;
}

/** 设置页行：左侧标题 / 说明，右侧控件。设置类页面统一复用，不要再各自手写 flex 行。 */
export function SettingRow({ title, description, control, overridden, extra, style }: SettingRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', ...style }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title heading={6} style={{ margin: 0 }}>{title}</Title>
          {overridden ? <Tag size="small" color="blue">已覆盖</Tag> : null}
          {extra}
        </div>
        {description ? <Text type="tertiary" size="small">{description}</Text> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{control}</div>
    </div>
  );
}

/** 设置分组标题 */
export function SettingSection({ title, description, children }: { readonly title: ReactNode; readonly description?: ReactNode; readonly children: ReactNode }) {
  return (
    <section>
      <Title heading={6} style={{ margin: '24px 0 4px', color: 'var(--semi-color-text-2)', fontWeight: 600 }}>{title}</Title>
      {description ? <Text type="tertiary" size="small">{description}</Text> : null}
      {children}
    </section>
  );
}

/** 行间分隔线（零上下间距，贴合 SettingRow 的内边距） */
export function SettingDivider() {
  return <Divider margin={0} />;
}
