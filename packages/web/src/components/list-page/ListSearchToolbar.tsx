import type { ReactNode } from 'react';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';

export interface ListSearchToolbarProps {
  /** 关键词输入（`KeywordInput`），桌面与移动端主区都展示 */
  keyword?: ReactNode;
  /** 其余筛选项（状态 / 类型 / 时间范围…）：桌面端内联，移动端收进筛选抽屉 */
  filters?: ReactNode;
  onSearch: () => void;
  onReset: () => void;
  /** 新增按钮：桌面端排在查询 / 重置之后，移动端保留在主区 */
  create?: ReactNode;
  /** 低频操作（导出 / 批量 / 同步…）：桌面端跟在新增之后，移动端收进「更多操作」菜单 */
  actions?: ReactNode;
  /** 覆盖移动端更多菜单内容；缺省与 `actions` 相同 */
  mobileActions?: ReactNode;
  filterTitle?: ReactNode;
  actionTitle?: string;
  className?: string;
}

const present = (node: ReactNode) => node !== undefined && node !== null && node !== false;

/**
 * 标准列表页工具栏：把 `SearchToolbar` 的桌面 / 移动槽位排布规则写在一处——
 * 桌面：关键词 → 筛选项 → 查询 / 重置 → 新增 → 低频操作；
 * 移动：主区 关键词 + 查询 + 新增，筛选项进抽屉（应用 / 重置即查询 / 重置），低频操作进更多菜单。
 * 控件本身仍由页面创建（占位文案、字典项、权限门控都在页面里可见）。
 */
export function ListSearchToolbar({
  keyword,
  filters,
  onSearch,
  onReset,
  create,
  actions,
  mobileActions,
  filterTitle,
  actionTitle,
  className,
}: ListSearchToolbarProps) {
  const desktopActions = present(create) || present(actions) ? <>{create}{actions}</> : undefined;
  return (
    <SearchToolbar
      className={className}
      primary={(
        <>
          {keyword}
          {filters}
          <SearchButton onClick={onSearch} />
          <ResetButton onClick={onReset} />
        </>
      )}
      actions={desktopActions}
      mobilePrimary={(
        <>
          {keyword}
          <SearchButton onClick={onSearch} />
          {create}
        </>
      )}
      mobileFilters={present(filters) ? filters : undefined}
      // SearchToolbar 对 mobileActions 缺省回落到 actions；新增按钮已在移动主区，这里用 false 明确「没有更多操作」
      mobileActions={mobileActions ?? (present(actions) ? actions : false)}
      filterTitle={filterTitle}
      actionTitle={actionTitle}
      onFilterApply={onSearch}
      onFilterReset={onReset}
    />
  );
}
