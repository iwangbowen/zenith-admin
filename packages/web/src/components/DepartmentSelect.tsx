import { useMemo } from 'react';
import { TreeSelect } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
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

export interface DepartmentTreeSelectProps extends DepartmentSelectProps {
  treeData: TreeNodeData[];
  loading?: boolean;
}

/** 纯展示型部门树选择：数据源由调用方提供，管理端与工作流端共用同一交互。 */
export function DepartmentTreeSelect({
  treeData,
  loading = false,
  value,
  onChange,
  multiple = false,
  placeholder = '请选择部门',
  disabled = false,
  showClear = true,
  style,
}: Readonly<DepartmentTreeSelectProps>) {
  return (
    <TreeSelect
      treeData={treeData}
      value={value as never}
      onChange={(v) => onChange?.(v as number | number[] | undefined)}
      multiple={multiple}
      filterTreeNode
      leafOnly={false}
      maxTagCount={3}
      showRestTagsPopover
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      style={{ width: '100%', ...style }}
    />
  );
}

/**
 * 部门选择器 — 管理端 / 系统组织架构场景，复用 useDepartmentTree 域 hook。
 * 工作流表单请使用 `WorkflowDeptSelect`（只需工作流权限，不要求部门管理权限）。
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
    <DepartmentTreeSelect
      treeData={treeData}
      loading={loading}
      value={value}
      onChange={onChange}
      multiple={multiple}
      placeholder={placeholder}
      disabled={disabled}
      showClear={showClear}
      style={style}
    />
  );
}
