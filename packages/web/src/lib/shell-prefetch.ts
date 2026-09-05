import type { QueryClient } from '@tanstack/react-query';
import { TOKEN_KEY } from '@zenith/shared/core';
import { settingsContract } from '@zenith/shared/settings';
import { apiQueryOptions } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { userMenuTreeQueryOptions } from '@/hooks/queries/menus';
import { prewarmLucideIcons } from '@/utils/icons';

/**
 * 已登录用户冷启动的投机预取。
 *
 * 有本地凭证时，用户大概率落进后台壳（AdminLayout + 仪表盘）。不等 `/api/auth/me` 返回，
 * 在应用挂载时就并行发起：
 * - 后台壳 chunk（AdminLayout / DashboardPage）的下载——动态 import 由模块加载器去重，与 React.lazy 共享同一份请求；
 * - 侧栏首帧依赖的图标全量表；
 * - 只依赖凭证、不依赖用户对象的数据：用户可见菜单树、登录用户设置投影。它们与 hook 使用同一 query key，
 *   预取结果直接被后续挂载的 hook 命中，把「/me → 菜单树 → 布局」的串行链路压成一轮。
 * 凭证已失效时这些请求会与 /me 一样收到 401，由请求层统一处理，预取本身不额外提示。
 */
export function prefetchAdminShell(queryClient: QueryClient): void {
  if (typeof localStorage === 'undefined' || !localStorage.getItem(TOKEN_KEY)) return;
  prewarmLucideIcons();
  void import('@/layouts/AdminLayout').catch(() => {});
  void import('@/pages/dashboard/DashboardPage').catch(() => {});
  void queryClient.prefetchQuery(userMenuTreeQueryOptions());
  void queryClient.prefetchQuery(apiQueryOptions(settingsContract.me, { staleTime: LOOKUP_STALE_TIME, requestOptions: { silent: true } }));
}