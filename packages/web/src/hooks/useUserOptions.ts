/**
 * 用户下拉选项 hook —— 统一从用户下拉源（`userContract.all`）拉取人员并映射为 { label, value }。
 *
 * 数据源复用 `hooks/queries/users.ts` 的 `allUsersQueryOptions`，缓存/在途去重/失效联动
 * 全部由 TanStack Query 承担（此前是模块级 `let cache` + `let inflight` 手写实现，
 * 与 useAllUsers 打同一端点却各存一份，且手写缓存永不失效——改了昵称要刷新整页才更新）。
 *
 * 支持两种取数时机：
 *   - immediate: true  → 挂载即加载（如发起页抄送人需要立即可选）
 *   - 默认 lazy       → 由调用方在需要时 await ensureLoaded()（如审批动作弹窗打开时）
 */
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { allUsersQueryOptions, useAllUsers } from '@/hooks/queries/users';

export interface UserOption {
  label: string;
  value: number;
}

const EMPTY_OPTIONS: UserOption[] = [];

function toOptions(users: Array<{ id: number; nickname: string; username: string }>): UserOption[] {
  return users.map((u) => ({ label: u.nickname ?? u.username, value: u.id }));
}

export function useUserOptions(options?: { immediate?: boolean }) {
  const [enabled, setEnabled] = useState(options?.immediate ?? false);
  const queryClient = useQueryClient();
  const { data, isPending } = useAllUsers({ enabled });

  const userOptions = useMemo(() => (data ? toOptions(data) : EMPTY_OPTIONS), [data]);

  // 命令式取数：拉起查询并返回结果，同时打开订阅让组件在数据到达后重渲染
  const ensureLoaded = useCallback(async (): Promise<UserOption[]> => {
    setEnabled(true);
    const users = await queryClient.ensureQueryData(allUsersQueryOptions());
    return toOptions(users);
  }, [queryClient]);

  return { userOptions, loading: enabled && isPending, ensureLoaded };
}
