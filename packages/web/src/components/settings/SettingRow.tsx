import type { CSSProperties, ReactNode } from 'react';
import { Button, Divider, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import type { PreferencePath } from '@zenith/shared/preferences';
import { usePreferences } from '@/hooks/usePreferences';
import { SlotProbe, useRenderedSlot } from '@/components/rendered-slot';
import '../preferences/preference-control.css';

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

/** 只撤销本项的个人覆盖，恢复系统当前值；锁定或不适用的项目不提供入口。 */
export function PreferenceResetButton({ path }: { readonly path: PreferencePath }) {
  const { canEditPreference, isPreferenceOverridden, resetPreference } = usePreferences();
  if (!canEditPreference(path) || !isPreferenceOverridden(path)) return null;
  return (
    <Tooltip content="清除这项个人选择，跟随系统当前默认值">
      <Button size="small" theme="borderless" type="tertiary" icon={<RotateCcw size={12} />}
        aria-label={`${path}恢复系统默认`} onClick={() => resetPreference(path)}>跟随系统</Button>
    </Tooltip>
  );
}

/** 保留各偏好的专用控件，统一处理策略隐藏与恢复继承。 */
export function PreferenceControl({ path, children, inline = false }: {
  readonly path: PreferencePath;
  readonly children: ReactNode;
  readonly inline?: boolean;
}) {
  const { canEditPreference, isPreferenceOverridden } = usePreferences();
  if (!canEditPreference(path)) return null;
  return (
    <div className={`preference-control${inline ? ' preference-control--inline' : ''}`} data-preference-path={path}>
      {children}
      {isPreferenceOverridden(path) ? (
        <span className="preference-control__reset"><PreferenceResetButton path={path} /></span>
      ) : null}
    </div>
  );
}

/** 字段被权限、适用条件或搜索全部过滤后，分组标题一起隐藏。 */
export function PreferenceSection({ title, children }: { readonly title: ReactNode; readonly children: ReactNode }) {
  usePreferences();
  const { probeRef, rendered } = useRenderedSlot();
  return <>{rendered ? title : null}<SlotProbe ref={probeRef}>{children}</SlotProbe></>;
}
