import { useMemo } from 'react';
import { Select } from '@douyinfe/semi-ui';
import type { CSSProperties } from 'react';
import { useAllUsers } from '@/hooks/queries/users';

export interface UserSelectProps {
  value?: number | number[];
  onChange?: (value: number | number[] | undefined) => void;
  multiple?: boolean;
  placeholder?: string;
  disabled?: boolean;
  showClear?: boolean;
  style?: CSSProperties;
}

/** 选人数据源的最小形状：系统全量用户与工作流可选人员都满足 */
export interface UserSelectOptionSource {
  id: number;
  nickname: string;
  departmentName?: string | null;
}

export interface UserSelectBaseProps extends UserSelectProps {
  users: readonly UserSelectOptionSource[] | undefined;
  loading: boolean;
}

/**
 * 用户选择器渲染体（不含数据源）：单选 / 多选、可搜索、加载中禁用。
 * 不同权限范围的选人数据源（系统全量 / 工作流可选人员）各自取数后交给它渲染。
 */
export function UserSelectBase({
  users,
  loading,
  value,
  onChange,
  multiple = false,
  placeholder = '请选择人员',
  disabled = false,
  showClear = true,
  style,
}: Readonly<UserSelectBaseProps>) {
  const optionList = useMemo(
    () => (users ?? []).map((u) => ({
      value: u.id,
      label: u.departmentName ? `${u.nickname}（${u.departmentName}）` : u.nickname,
    })),
    [users],
  );

  return (
    <Select
      value={value as never}
      onChange={(v) => onChange?.(v as number | number[] | undefined)}
      multiple={multiple}
      filter
      placeholder={loading ? '加载中...' : placeholder}
      disabled={disabled || loading}
      showClear={showClear}
      maxTagCount={3}
      style={{ width: '100%', ...style }}
      optionList={optionList}
    />
  );
}

/**
 * 用户选择器 — 与系统用户体系集成，复用 useAllUsers 域 hook（需要 system:user:list）。
 * 支持单选 / 多选，可直接用于 Semi Form（withField 包裹）。
 */
export default function UserSelect(props: Readonly<UserSelectProps>) {
  const { data: users, isPending: loading } = useAllUsers();
  return <UserSelectBase {...props} users={users} loading={loading} />;
}
