import { Tag } from '@douyinfe/semi-ui';
import type { TagProps } from '@douyinfe/semi-ui/lib/es/tag';
import { useDictItems } from '../hooks/useDictItems';

interface DictTagProps extends Omit<TagProps, 'color' | 'children'> {
  /** 字典编码，如 'common_status' */
  dictCode: string;
  /** 字典项的值 */
  value: string | undefined | null;
  /** 找不到字典项时的兜底文本，默认显示原始 value */
  fallback?: string;
}

/**
 * 根据字典编码和值，自动渲染带颜色的 Tag。
 * 颜色来源于字典项的 color 字段。
 */
export default function DictTag({ dictCode, value, fallback, size = 'small', ...rest }: DictTagProps) {
  const { items } = useDictItems(dictCode);

  if (value == null || value === '') {
    return <span>—</span>;
  }

  const item = items.find((i) => i.value === value);
  const label = item?.label ?? fallback ?? value;
  const color = item?.color as TagProps['color'];

  return (
    <Tag color={color} size={size} {...rest}>
      {label}
    </Tag>
  );
}
