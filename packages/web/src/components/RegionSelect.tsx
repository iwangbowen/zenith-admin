import { Cascader } from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import type { Region } from '@zenith/shared';
import { useRegionLookupTree } from '@/hooks/queries/regions';

interface CascaderItem {
  label: string;
  value: string;
  children?: CascaderItem[];
}

function regionsToCascader(regions: Region[]): CascaderItem[] {
  return regions
    .filter((r) => r.status === 'enabled')
    .map((r) => ({
      label: r.name,
      value: r.code,
      children: r.children ? regionsToCascader(r.children) : undefined,
    }));
}

export interface RegionSelectProps {
  /** 当前选中的区划代码路径，如 ['110000', '110100', '110101'] */
  value?: string[];
  onChange?: (value: string[] | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
  className?: string;
  /** 是否允许选中任意层级（省/市/县均可作为最终结果），默认 true */
  changeOnSelect?: boolean;
}

/**
 * 省市区三级联动选择组件，基于 Semi Design Cascader 封装。
 *
 * @example
 * <RegionSelect
 *   value={['110000', '110100']}
 *   onChange={(val) => console.log(val)}
 *   placeholder="请选择省/市/区"
 * />
 */
export default function RegionSelect({
  value,
  onChange,
  placeholder = '请选择省/市/区',
  disabled = false,
  showClear = true,
  style,
  className,
  changeOnSelect = true,
}: Readonly<RegionSelectProps>) {
  const regionsQuery = useRegionLookupTree();
  const loading = regionsQuery.isLoading;
  const treeData = regionsToCascader(regionsQuery.data ?? []);

  return (
    <Cascader
      treeData={treeData}
      value={value}
      onChange={(val) => {
        if (!val || (Array.isArray(val) && val.length === 0)) {
          onChange?.(undefined);
        } else {
          onChange?.(val as string[]);
        }
      }}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      changeOnSelect={changeOnSelect}
      style={style}
      className={className}
      filterTreeNode
    />
  );
}
