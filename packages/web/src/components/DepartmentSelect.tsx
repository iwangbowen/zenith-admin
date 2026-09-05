import { useMemo } from 'react';
import { TreeSelect } from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import type { Department } from '@zenith/shared/identity';
import { useDepartmentTree } from '@/hooks/queries/departments';

interface DeptTreeNode {
  label: string;
  value: number;
  key: string;
  children?: DeptTreeNode[];
}

function deptToTree(list: Department[]): DeptTreeNode[] {
  return list
    .filter((d) => d.status === 'enabled')
    .map((d) => ({
      label: d.name,
      value: d.id,
      key: String(d.id),
      children: d.children && d.children.length > 0 ? deptToTree(d.children) : undefined,
    }));
}

export interface DepartmentSelectProps {
  value?: number | number[];
  onChange?: (value: number | number[] | undefined) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

/**
 * 部门选择器 — 与系统组织架构集成，复用 useDepartmentTree 域 hook。
 * 支持单选 / 多选，可直接用于 Semi Form（withField 包裹）。
 */
export default function DepartmentSelect({
  value,
  onChange,
  multiple = false,
  placeholder = '请选择部门',
  disabled = false,
  showClear = true,
  style,
}: Readonly<DepartmentSelectProps>) {
  const { data: departments, isPending: loading } = useDepartmentTree();

  const treeData = useMemo(() => deptToTree(departments ?? []), [departments]);

  return (
    <TreeSelect
      treeData={treeData}
      value={value as never}
      onChange={(v) => onChange?.(v as number | number[] | undefined)}
      multiple={multiple}
      filterTreeNode
      leafOnly={false}
      maxTagCount={3}
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      style={{ width: '100%', ...style }}
    />
  );
}
