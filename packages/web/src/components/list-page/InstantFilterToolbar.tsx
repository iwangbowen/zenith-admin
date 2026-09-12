import type { ReactNode } from 'react';
import { SearchToolbar } from '@/components/SearchToolbar';
import { RefreshButton, ResetButton } from '@/components/toolbar-controls';

export interface InstantFilterToolbarProps {
  /** 主区控件（关键字输入 / 主机或站点等作用域切换），桌面与移动端主区都展示 */
  primary?: ReactNode;
  /** 选中即生效的筛选项：桌面端内联，移动端收进抽屉（抽屉没有「查询」页脚，改值即筛） */
  filters?: ReactNode;
  /** 重新拉取数据；传入即渲染 `RefreshButton`（桌面跟在筛选项后，移动端留在主区） */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** 清空筛选条件；传入即渲染 `ResetButton`，移动端出现在筛选抽屉页脚 */
  onReset?: () => void;
  /** 新增 / 清理等操作：桌面端跟在刷新之后，移动端收进「更多操作」菜单 */
  actions?: ReactNode;
  /** 覆盖移动端更多菜单内容；缺省与 `actions` 相同 */
  mobileActions?: ReactNode;
  /** 只在桌面端展示的说明文字（如「共 N 个监听端口」「规则保存后立即热更新」） */
  extra?: ReactNode;
  filterTitle?: ReactNode;
  actionTitle?: string;
  className?: string;
}

const present = (node: ReactNode) => Boolean(node);

/**
 * 「边输边筛 + 刷新」型工具栏：进程 / 服务 / 容器 / 端口这类一次取全量、在客户端即时过滤、没有「查询」按钮语义的页面。
 * 与 `ListSearchToolbar` 一样把桌面 / 移动排布写在一处——
 * 桌面：主区 → 筛选项 → 刷新 → 重置 → 操作 → 说明；移动：主区 + 刷新，筛选项进抽屉，操作进更多菜单。
 * 页面不再为 `primary` / `mobilePrimary` 各写一份同样的控件。
 */
export function InstantFilterToolbar({
  primary,
  filters,
  onRefresh,
  refreshing,
  onReset,
  actions,
  mobileActions,
  extra,
  filterTitle,
  actionTitle,
  className,
}: InstantFilterToolbarProps) {
  const refresh = onRefresh ? <RefreshButton onClick={onRefresh} loading={refreshing} /> : null;
  const desktopActions = present(actions) || present(extra) ? <>{actions}{extra}</> : undefined;
  return (
    <SearchToolbar
      className={className}
      primary={(
        <>
          {primary}
          {filters}
          {refresh}
          {onReset ? <ResetButton onClick={onReset} /> : null}
        </>
      )}
      actions={desktopActions}
      mobilePrimary={(
        <>
          {primary}
          {refresh}
        </>
      )}
      mobileFilters={present(filters) ? filters : undefined}
      // SearchToolbar 对 mobileActions 缺省回落到 actions；说明文字不进更多菜单，这里显式给出
      mobileActions={mobileActions ?? (present(actions) ? actions : false)}
      filterTitle={filterTitle}
      actionTitle={actionTitle}
      onFilterReset={onReset}
    />
  );
}
