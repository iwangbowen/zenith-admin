import { Button, ColorPicker } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import type { CSSProperties } from 'react';

export interface ColorPickerInputProps {
  /** 颜色值（hex，或开启 alpha 时为 rgba 字符串）；空串/undefined 视为未选择 */
  value?: string;
  onChange?: (value: string) => void;
  /** 是否支持透明度 */
  alpha?: boolean;
  /** 展示「清除」按钮，选中后 onChange('')，用于颜色可空的场景（如留空跟随默认） */
  allowClear?: boolean;
  /** 清除按钮提示文案 */
  clearTitle?: string;
  /** 只读态：展示色块 + 文本，不渲染交互选择器（ColorPicker 无 disabled 属性） */
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * 颜色选择器 — 基于 Semi ColorPicker 封装，表单值统一存储为字符串（hex / rgba）。
 * 可直接用于 Semi Form（withField 包裹）。
 */
export default function ColorPickerInput({
  value,
  onChange,
  alpha = false,
  allowClear = false,
  clearTitle = '清除颜色',
  disabled = false,
  style,
}: Readonly<ColorPickerInputProps>) {
  if (disabled) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
        <span style={{
          width: 20, height: 20, borderRadius: 'var(--semi-border-radius-small)',
          border: '1px solid var(--semi-color-border)',
          background: value || 'transparent',
        }} />
        <span style={{ fontSize: 13, color: 'var(--semi-color-text-1)' }}>{value || '（未选择）'}</span>
      </div>
    );
  }

  const colorValue = value ? ColorPicker.colorStringToValue(value) : undefined;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <ColorPicker
        usePopover
        alpha={alpha}
        value={colorValue}
        onChange={(v) => {
          const next = alpha
            ? `rgba(${v.rgba.r}, ${v.rgba.g}, ${v.rgba.b}, ${Number(v.rgba.a.toFixed(2))})`
            : v.hex;
          onChange?.(next);
        }}
      >
        {/* value 为空时渲染空态触发块：Semi 的默认色块会回落到组件内置 defaultValue（#39c5bb），
            让「留空」看起来像已选了一个青绿色 */}
        {value ? undefined : (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 20,
              height: 20,
              borderRadius: 'var(--semi-border-radius-small)',
              border: '1px dashed var(--semi-color-border)',
              verticalAlign: 'middle',
              cursor: 'pointer',
            }}
          />
        )}
      </ColorPicker>
      {allowClear && value ? (
        <Button
          type="tertiary"
          theme="borderless"
          icon={<X size={14} />}
          aria-label={clearTitle}
          title={clearTitle}
          onClick={() => onChange?.('')}
          style={{ padding: 4, minWidth: 0, flexShrink: 0 }}
        />
      ) : null}
    </div>
  );
}
