/**
 * 数据权限面板（可复用于角色管理 & 用户管理）
 *
 * Props:
 *  - dataScope:       当前数据权限类型
 *  - deptScopeIds:    当前指定的部门 ID 列表（custom 时有效）
 *  - deptTree:        部门树数据
 *  - onScopeChange:   数据权限类型变更回调
 *  - onDeptIdsChange: 部门 ID 列表变更回调
 *  - loading?:        是否显示骨架屏
 *  - nullable?:       是否允许选择「跟随角色」（null 值，用于用户级权限）
 *  - readonly?:       只读模式
 */
import { Select, Spin, TreeSelect } from '@douyinfe/semi-ui';
import type { Department } from '@zenith/shared';

export const DATA_SCOPE_OPTIONS = [
  { value: 'all', label: '全部数据权限' },
  { value: 'custom', label: '指定部门数据权限' },
  { value: 'dept_only', label: '本部门数据权限' },
  { value: 'dept', label: '本部门及以下数据权限' },
  { value: 'self', label: '仅本人数据权限' },
];

type DataScopePanelProps = Readonly<{
  dataScope: string | null;
  deptScopeIds: number[];
  deptTree: Department[];
  onScopeChange?: (scope: string | null) => void;
  onDeptIdsChange?: (ids: number[]) => void;
  loading?: boolean;
  nullable?: boolean;
  readonly?: boolean;
}>;

function deptsToTreeData(items: Department[]): object[] {
  return items.map((d) => ({
    label: d.name,
    key: String(d.id),
    value: d.id,
    children: d.children ? deptsToTreeData(d.children) : undefined,
  }));
}

export function DataScopePanel({
  dataScope,
  deptScopeIds,
  deptTree,
  onScopeChange,
  onDeptIdsChange,
  loading = false,
  nullable = false,
  readonly = false,
}: DataScopePanelProps) {
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
        <Spin />
      </div>
    );
  }

  const options = nullable
    ? [{ value: '__null__', label: '跟随角色（不单独设置）' }, ...DATA_SCOPE_OPTIONS]
    : DATA_SCOPE_OPTIONS;

  const selectValue = dataScope === null ? '__null__' : (dataScope ?? '__null__');

  return (
    <>
      <Select
        value={selectValue}
        disabled={readonly}
        onChange={(v) => {
          if (readonly) return;
          const val = v as string;
          onScopeChange?.(val === '__null__' ? null : val);
        }}
        style={{ width: '100%' }}
        optionList={options}
      />
      {dataScope === 'custom' && (
        <TreeSelect
          multiple
          filterTreeNode
          disabled={readonly}
          treeData={deptsToTreeData(deptTree)}
          value={deptScopeIds}
          onChange={(vals) => {
            if (readonly) return;
            onDeptIdsChange?.((vals as number[]));
          }}
          placeholder="请选择指定部门（可多选）"
          style={{ width: '100%', marginTop: 12 }}
        />
      )}
    </>
  );
}
