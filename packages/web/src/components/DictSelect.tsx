import { Select } from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import { useDictItems } from '@/hooks/useDictItems';

export interface DictSelectProps {
  /** 绑定的数据字典 code */
  dictCode?: string;
  value?: string | string[];
  onChange?: (value: string | string[] | undefined) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

/**
 * 数据字典选择器 — 与系统数据字典集成，按 dictCode 拉取字典项。
 * 支持单选 / 多选，可直接用于 Semi Form（withField 包裹）。
 */
export default function DictSelect({
  dictCode,
  value,
  onChange,
  multiple = false,
  placeholder = '请选择',
  disabled = false,
  showClear = true,
  style,
}: Readonly<DictSelectProps>) {
  const { options, loading } = useDictItems(dictCode ?? '');

  if (!dictCode) {
    return (
      <Select
        disabled
        placeholder="未配置数据字典"
        style={{ width: '100%', ...style }}
      />
    );
  }

  return (
    <Select
      value={value as never}
      onChange={(v) => onChange?.(v as string | string[] | undefined)}
      multiple={multiple}
      filter
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      maxTagCount={4}
      style={{ width: '100%', ...style }}
      optionList={options}
    />
  );
}
