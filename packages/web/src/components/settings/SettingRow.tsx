import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Divider, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import { RotateCcw } from 'lucide-react';
import { preferenceDefinitionMap, type PreferencePath } from '@zenith/shared/preferences';
import { usePreferences } from '@/hooks/usePreferences';
import { useElementSize } from '@/hooks/useElementSize';
import { SlotProbe, useRenderedSlot } from '@/components/rendered-slot';
import '../preferences/preference-control.css';

const { Text, Title } = Typography;

export interface SettingRowProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly control: ReactNode;
  /** 当前值来自本作用域的显式覆盖（即使与上级相同），标记「已覆盖」 */
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
    <Tooltip content="重置设置">
      <Button className="preference-reset-button" size="small" theme="borderless" type="tertiary"
        icon={<RotateCcw size={14} />} aria-label={`重置设置：${preferenceDefinitionMap[path].label}`}
        onClick={() => resetPreference(path)} />
    </Tooltip>
  );
}

let textMeasureContext: CanvasRenderingContext2D | null | undefined;

/**
 * 设置名称首行文字的墨迹中线（视口坐标）。字号小于行高时字形并不居中于行盒
 * （如 13px 的「导航布局」比行盒中线低约 1px），按字体度量求出实际字形中线；
 * 取不到文字或度量时退回名称元素的几何中线。
 */
function labelInkCenter(label: Element): number {
  const box = label.getBoundingClientRect();
  const fallback = box.top + box.height / 2;
  const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  }).nextNode();
  const style = text?.parentElement ? getComputedStyle(text.parentElement) : null;
  if (!text || !style) return fallback;
  const range = document.createRange();
  range.selectNodeContents(text);
  const line = range.getClientRects()[0];
  textMeasureContext ??= document.createElement('canvas').getContext('2d');
  if (!line?.height || !textMeasureContext) return fallback;
  // 按 100px 取度量再缩放，避开画布按整数像素取整的半像素误差
  textMeasureContext.font = `${style.fontStyle} ${style.fontWeight} 100px ${style.fontFamily}`;
  const metrics = textMeasureContext.measureText(text.textContent?.trim() ?? '');
  if (!Number.isFinite(metrics.fontBoundingBoxAscent) || !Number.isFinite(metrics.actualBoundingBoxAscent)) return fallback;
  const scale = Number.parseFloat(style.fontSize) / 100;
  const ascent = metrics.fontBoundingBoxAscent * scale;
  const descent = metrics.fontBoundingBoxDescent * scale;
  const baseline = line.top + (line.height - ascent - descent) / 2 + ascent;
  return baseline - ((metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) * scale) / 2;
}

/**
 * 设置名称左侧留白里的重置入口。名称即控件根元素的首个子元素，
 * 按名称文字的中线定位，单行开关、高控件与上下堆叠的选择器都能对齐，出现 / 消失也不推动名称。
 */
function PreferenceResetGutter({ path }: { readonly path: PreferencePath }) {
  const { ref, height } = useElementSize<HTMLSpanElement>();
  const [labelCenter, setLabelCenter] = useState<number | null>(null);
  useLayoutEffect(() => {
    const gutter = ref.current;
    const row = gutter?.nextElementSibling;
    const label = row?.firstElementChild ?? row;
    if (!gutter || !label) return;
    const next = Math.round((labelInkCenter(label) - gutter.getBoundingClientRect().top) * 10) / 10;
    setLabelCenter((prev) => (prev === next ? prev : next));
  }, [ref, height]);
  return (
    <span ref={ref} className="preference-control__gutter">
      <span className="preference-control__reset" style={labelCenter === null ? undefined : { top: labelCenter }}>
        <PreferenceResetButton path={path} />
      </span>
    </span>
  );
}

/** 保留各偏好的专用控件，统一处理策略隐藏与单项重置。 */
export function PreferenceControl({ path, children, inline = false }: {
  readonly path: PreferencePath;
  readonly children: ReactNode;
  readonly inline?: boolean;
}) {
  const { canEditPreference, isPreferenceOverridden } = usePreferences();
  if (!canEditPreference(path)) return null;
  const overridden = isPreferenceOverridden(path);
  if (inline) {
    return (
      <div className="preference-control preference-control--inline" data-preference-path={path}>
        {children}
        {overridden ? <PreferenceResetButton path={path} /> : null}
      </div>
    );
  }
  return (
    <div className="preference-control" data-preference-path={path}>
      {overridden ? <PreferenceResetGutter path={path} /> : null}
      {children}
    </div>
  );
}

/** 字段被权限、适用条件或搜索全部过滤后，分组标题一起隐藏。 */
export function PreferenceSection({ title, children }: { readonly title: ReactNode; readonly children: ReactNode }) {
  usePreferences();
  const { probeRef, rendered } = useRenderedSlot();
  return <>{rendered ? title : null}<SlotProbe ref={probeRef}>{children}</SlotProbe></>;
}
