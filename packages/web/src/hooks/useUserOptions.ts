/**
 * 用户下拉选项 hook —— 统一从 /api/users/all 拉取人员并映射为 { label, value }。
 *
 * 进程级缓存 + 在途请求去重：多处同时使用（发起抄送人、审批转办/委派/加签、监控改派等）
 * 也只会真正请求一次。支持两种取数时机：
 *   - immediate: true  → 挂载即加载（如发起页抄送人需要立即可选）
 *   - 默认 lazy       → 由调用方在需要时 await ensureLoaded()（如审批动作弹窗打开时）
 */
import { useCallback, useEffect, useState } from 'react';
import { request } from '@/utils/request';

export interface UserOption {
  label: string;
  value: number;
}

let cache: UserOption[] | null = null;
let inflight: Promise<UserOption[]> | null = null;

async function fetchUserOptions(): Promise<UserOption[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = request
    .get<Array<{ id: number; nickname: string; username: string }>>('/api/users/all', { silent: true })
    .then((res) => {
      if (res.code === 0 && res.data) {
        cache = res.data.map((u) => ({ label: u.nickname ?? u.username, value: u.id }));
        return cache;
      }
      return [];
    })
    .catch(() => [])
    .finally(() => { inflight = null; });
  return inflight;
}

export function useUserOptions(options?: { immediate?: boolean }) {
  const immediate = options?.immediate ?? false;
  const [userOptions, setUserOptions] = useState<UserOption[]>(cache ?? []);
  const [loading, setLoading] = useState(false);

  const ensureLoaded = useCallback(async () => {
    if (cache) {
      setUserOptions(cache);
      return cache;
    }
    setLoading(true);
    const opts = await fetchUserOptions();
    setUserOptions(opts);
    setLoading(false);
    return opts;
  }, []);

  useEffect(() => {
    if (immediate) void ensureLoaded();
  }, [immediate, ensureLoaded]);

  return { userOptions, loading, ensureLoaded };
}
