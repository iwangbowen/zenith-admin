import { ColorPicker, Tooltip } from '@douyinfe/semi-ui';
import { Check, Palette } from 'lucide-react';
import './swatch-color-picker.css';

export interface SwatchColorOption {
  /** 存档值：主题预设 key 或 `#rrggbb` */
  key: string;
  /** 悬停提示 */
  label: string;
  /** 色块展示色 */
  color: string;
}

export interface SwatchColorPickerProps {
  /** 当前值：某个选项 key，或 `#rrggbb` 自定义色；标签场景空串表示无颜色 */
  value: string;
  onChange: (value: string) => void;
  options: readonly SwatchColorOption[];
  /** 允许通过取色器选择预设之外的颜色，缺省开启 */
  allowCustom?: boolean;
  customTitle?: string;
  /** 展示「无颜色」选项（选中后 onChange('')），用于颜色可空的场景 */
  allowClear?: boolean;
  clearTitle?: string;
}

/**
 * 色板颜色选择器：预设色块 + 自定义取色器，与个人偏好主题色同款交互。
 * value 语义由调用方决定（预设 key 或 hex），组件只做 `value === key` 与 `#` 前缀判断。
 */
export function SwatchColorPicker({
  value,
  onChange,
  options,
  allowCustom = true,
  customTitle = '自定义颜色',
  allowClear = false,
  clearTitle = '无颜色',
}: SwatchColorPickerProps) {
  const isCustomized = value.startsWith('#');
  return (
    <div className="swatch-color-picker">
      {allowClear && (
        <Tooltip content={clearTitle} position="top">
          <button
            type="button"
            aria-label={clearTitle}
            aria-pressed={value === ''}
            className={`swatch-color-swatch swatch-color-swatch--clear${value === '' ? ' swatch-color-swatch--active' : ''}`}
            onClick={() => onChange('')}
          >
            {value === '' && (
              <span className="swatch-color-swatch__check">
                <Check size={14} strokeWidth={2.5} />
              </span>
            )}
          </button>
        </Tooltip>
      )}
      {options.map((option) => {
        const isActive = value === option.key;
        return (
          <Tooltip key={option.key} content={option.label} position="top">
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={isActive}
              className={`swatch-color-swatch${isActive ? ' swatch-color-swatch--active' : ''}`}
              style={{ backgroundColor: option.color, color: option.color }}
              onClick={() => onChange(option.key)}
              title={option.label}
            >
              {isActive && (
                <span className="swatch-color-swatch__check">
                  <Check size={14} strokeWidth={2.5} />
                </span>
              )}
            </button>
          </Tooltip>
        );
      })}
      {allowCustom && (
        <ColorPicker
          alpha={false}
          usePopover
          value={isCustomized ? ColorPicker.colorStringToValue(value) : undefined}
          onChange={(v) => onChange(v.hex)}
          popoverProps={{ position: 'top', zIndex: 10010 }}
        >
          <button
            type="button"
            aria-label={customTitle}
            aria-pressed={isCustomized}
            className={`swatch-color-swatch swatch-color-swatch--custom${isCustomized ? ' swatch-color-swatch--active' : ''}`}
            style={isCustomized ? { backgroundColor: value, color: value } : {}}
            title={customTitle}
          >
            {isCustomized
              ? <span className="swatch-color-swatch__check"><Check size={14} strokeWidth={2.5} /></span>
              : <span className="swatch-color-swatch__icon"><Palette size={14} /></span>}
          </button>
        </ColorPicker>
      )}
    </div>
  );
}
