import { useMemo } from 'react';
import { Badge, ConfigProvider, Nav, Tooltip } from '@douyinfe/semi-ui';
import AppLogo from '@/components/AppLogo';
import type { DoubleRailStyle } from '@/hooks/usePreferences';
import { decorateNavItemsWithBadges, type NavItem } from './utils';

// 双列侧边栏（double 布局）：左侧首列（图标 / 图标 + 文字，见偏好 doubleRailStyle）+ 右侧子导航
export function DoubleSidebar({
  doubleSubItems,
  stickyNavClass,
  showLogo,
  navigateHome,
  handleNavigateHomeKey,
  navItems,
  effectiveTopKey,
  handleDoubleRailClick,
  currentSelectedKeys,
  openKeys,
  handleSidebarOpenChange,
  renderWrapper,
  darkClassName = '',
  getPopupContainer,
  toggleIconPosition = 'right',
  railStyle = 'icon',
}: Readonly<{
  doubleSubItems: NavItem[];
  stickyNavClass: string;
  showLogo: boolean;
  navigateHome: () => void;
  handleNavigateHomeKey: (e: React.KeyboardEvent) => void;
  navItems: NavItem[];
  effectiveTopKey: string | null;
  handleDoubleRailClick: (item: NavItem) => void;
  currentSelectedKeys: string[];
  openKeys: string[];
  handleSidebarOpenChange: (data: { openKeys?: (string | number)[] }) => void;
  renderWrapper: (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => React.ReactNode;
  /** 分区深色时挂到侧边栏根元素的 Semi 局部暗色类名（含前导空格） */
  darkClassName?: string;
  /** 分区深色时把 rail Tooltip 与子导航弹层挂进带 .semi-always-dark 的节点 */
  getPopupContainer?: () => HTMLElement;
  /** 子菜单展开/收起箭头位置，默认右侧 */
  toggleIconPosition?: 'left' | 'right';
  /** 首列形态：仅图标（默认，与单列收起同宽）/ 图标 + 文字 */
  railStyle?: DoubleRailStyle;
}>) {
  // 子导航未读徽标拼进文字（与垂直侧边栏一致）
  const decoratedSubItems = useMemo(() => decorateNavItemsWithBadges(doubleSubItems), [doubleSubItems]);
  const showRailText = railStyle === 'icon-text';
  return (
    <aside className={`admin-sidebar admin-sidebar--double admin-sidebar--double-${railStyle}${doubleSubItems.length === 0 ? ' admin-sidebar--double-no-sub' : ''}${stickyNavClass}${darkClassName}`}>
      <ConfigProvider getPopupContainer={getPopupContainer}>
        {/* Left rail：仅图标时名称只走 Tooltip / aria-label */}
        <div className="double-sidebar__rail">
          {showLogo && (
            <button
              type="button"
              className="double-sidebar__logo"
              onClick={navigateHome}
              onKeyDown={handleNavigateHomeKey}
            >
              <AppLogo size={26} />
            </button>
          )}
          <div className="double-sidebar__rail-list" role="navigation" aria-label="分组导航">
            {navItems.map((item) => {
              const isActive = effectiveTopKey === item.itemKey;
              return (
                <Tooltip key={item.itemKey} content={item.text} position="right">
                  <button
                    type="button"
                    className={`double-sidebar__rail-item${isActive ? ' double-sidebar__rail-item--active' : ''}`}
                    onClick={() => handleDoubleRailClick(item)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={typeof item.text === 'string' ? item.text : undefined}
                  >
                    <span className="double-sidebar__rail-icon">
                      {item.badge && item.badge.count > 0 ? (
                        <Badge count={item.badge.count} overflowCount={item.badge.overflowCount ?? 99} type="danger">
                          {item.icon}
                        </Badge>
                      ) : item.icon}
                    </span>
                    {showRailText && <span className="double-sidebar__rail-label">{item.text}</span>}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>
        {/* Right sub-nav */}
        <div className="double-sidebar__sub">
          {doubleSubItems.length > 0 && (
            <>
              <div className="double-sidebar__sub-title">
                {navItems.find((i) => i.itemKey === effectiveTopKey)?.text ?? ''}
              </div>
              <Nav
                className="admin-sidebar__nav double-sidebar__sub-nav"
                mode="vertical"
                items={decoratedSubItems}
                toggleIconPosition={toggleIconPosition}
                style={{ height: 'calc(100% - 48px)', overflow: 'hidden' }}
                bodyStyle={{ paddingTop: 8 }}
                isCollapsed={false}
                selectedKeys={currentSelectedKeys}
                openKeys={openKeys}
                onOpenChange={handleSidebarOpenChange}
                renderWrapper={renderWrapper}
              />
            </>
          )}
        </div>
      </ConfigProvider>
    </aside>
  );
}
