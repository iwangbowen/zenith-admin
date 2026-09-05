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

/**
 * 用户选择器 — 与系统用户体系集成，复用 useAllUsers 域 hook。
 * 支持单选 / 多选，可直接用于 Semi Form（withField 包裹）。
 */
export default function UserSelect({
  value,
  onChange,
  multiple = false,
  placeholder = '请选择人员',
  disabled = false,
  showClear = true,
  style,
}: Readonly<UserSelectProps>) {
  const { data: users, isPending: loading } = useAllUsers();

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
