import { useState, type ReactNode } from 'react';
import { Button, Dropdown, SideSheet, Space } from '@douyinfe/semi-ui';
import { Filter, MoreHorizontal, RotateCcw, Search } from 'lucide-react';

interface SearchToolbarProps {
  /** 工具栏内容（搜索输入框、下拉筛选、按钮等），自动用 `<Space wrap>` 包裹 */
  readonly children?: ReactNode;
  /** 附加 CSS 类名，附加到外层容器 */
  readonly className?: string;
  /** 移动端默认露出的核心搜索和主操作 */
  readonly primary?: ReactNode;
  /** 移动端收进底部抽屉的筛选项 */
  readonly filters?: ReactNode;
  /** 移动端收进更多菜单的低频操作 */
  readonly actions?: ReactNode;
  /** 移动端核心区域覆盖内容，不传则使用 primary */
  readonly mobilePrimary?: ReactNode;
  /** 移动端筛选抽屉覆盖内容，不传则使用 filters */
  readonly mobileFilters?: ReactNode;
  /** 移动端更多菜单覆盖内容，不传则使用 actions */
  readonly mobileActions?: ReactNode;
  readonly filterTitle?: ReactNode;
  readonly actionTitle?: string;
  readonly onFilterApply?: () => void;
  readonly onFilterReset?: () => void;
}

export function SearchToolbar({
  children,
  className,
  primary,
  filters,
  actions,
  mobilePrimary,
  mobileFilters,
  mobileActions,
  filterTitle = '筛选条件',
  actionTitle = '更多操作',
  onFilterApply,
  onFilterReset,
}: SearchToolbarProps) {
  const [filterVisible, setFilterVisible] = useState(false);
  const isStructured = Boolean(primary || filters || actions);
  const toolbarClassName = [
    'responsive-toolbar',
    isStructured ? 'responsive-toolbar--structured' : '',
    className ?? '',
  ].filter(Boolean).join(' ');

  if (!isStructured) {
    return (
      <div className="search-area">
        <div className={toolbarClassName}>
          <Space wrap style={{ width: '100%' }}>{children}</Space>
        </div>
      </div>
    );
  }

  const mobilePrimaryContent = mobilePrimary ?? primary;
  const mobileFiltersContent = mobileFilters ?? filters;
  const mobileActionsContent = mobileActions ?? actions;
  const hasFilters = Boolean(mobileFiltersContent);
  const hasActions = Boolean(mobileActionsContent);
  const hasFilterFooter = Boolean(onFilterApply || onFilterReset);

  return (
    <div className="search-area">
      <div className={toolbarClassName}>
        <div className="responsive-toolbar__desktop">
          <Space wrap style={{ width: '100%' }}>
            {primary}
            {filters}
            {actions}
          </Space>
        </div>

        <div className="responsive-toolbar__mobile">
          <div className="responsive-toolbar__mobile-primary">
            <Space wrap style={{ width: '100%' }}>
              {mobilePrimaryContent}
            </Space>
          </div>

          {(hasFilters || hasActions) && (
            <Space className="responsive-toolbar__mobile-extra" spacing={8}>
              {hasFilters && (
                <Button
                  icon={<Filter size={14} />}
                  onClick={() => setFilterVisible(true)}
                >
                  筛选
                </Button>
              )}
              {hasActions && (
                <Dropdown
                  trigger="click"
                  position="bottomRight"
                  clickToHide
                  render={(
                    <div className="responsive-toolbar__mobile-actions">
                      <div className="responsive-toolbar__mobile-actions-title">{actionTitle}</div>
                      <Space vertical spacing={8} style={{ width: '100%' }}>
                        {mobileActionsContent}
                      </Space>
                    </div>
                  )}
                >
                  <Button icon={<MoreHorizontal size={14} />} aria-label={actionTitle} />
                </Dropdown>
              )}
            </Space>
          )}
        </div>
      </div>

      {hasFilters && (
        <SideSheet
          className="search-toolbar-filter-sheet"
          title={filterTitle}
          visible={filterVisible}
          onCancel={() => setFilterVisible(false)}
          placement="bottom"
          height="min(72vh, 420px)"
          footer={hasFilterFooter ? (
            <Space>
              {onFilterReset && (
                <Button
                  type="tertiary"
                  icon={<RotateCcw size={14} />}
                  onClick={() => {
                    onFilterReset();
                    setFilterVisible(false);
                  }}
                >
                  重置
                </Button>
              )}
              {onFilterApply && (
                <Button
                  type="primary"
                  icon={<Search size={14} />}
                  onClick={() => {
                    onFilterApply();
                    setFilterVisible(false);
                  }}
                >
                  查询
                </Button>
              )}
            </Space>
          ) : null}
        >
          <Space vertical spacing={12} style={{ width: '100%' }}>
            {mobileFiltersContent}
          </Space>
        </SideSheet>
      )}
    </div>
  );
}
