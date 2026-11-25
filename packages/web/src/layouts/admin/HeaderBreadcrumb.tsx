import { Breadcrumb, Space, Tooltip } from '@douyinfe/semi-ui';
import { Star } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import BreadcrumbMenuPopover from '@/components/BreadcrumbMenuPopover';
import type { FlatMenuItem } from '@/components/MenuSearchInput';
import { renderLucideIcon } from '@/utils/icons';
import { findFirstLeafPath, type BreadcrumbData } from './utils';

// 顶栏面包屑（vertical / double 布局），含收藏当前页按钮
export function HeaderBreadcrumb({
  displayBreadcrumbs,
  breadcrumbIcon,
  breadcrumbSubMenu,
  breadcrumbClickable,
  showFavorites,
  navigateHome,
  navigate,
  pathname,
  flatMenus,
  isFavorite,
  toggleFavorite,
}: Readonly<{
  displayBreadcrumbs: BreadcrumbData[];
  breadcrumbIcon: boolean | undefined;
  breadcrumbSubMenu: boolean | undefined;
  breadcrumbClickable: boolean | undefined;
  showFavorites: boolean | undefined;
  navigateHome: () => void;
  navigate: NavigateFunction;
  pathname: string;
  flatMenus: FlatMenuItem[];
  isFavorite: (id: number) => boolean;
  toggleFavorite: (id: number) => void;
}>) {
  return (
    <div className="admin-header__breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Breadcrumb maxItemCount={10}>
        {displayBreadcrumbs.map((crumb, index) => {
          const isLast = index === displayBreadcrumbs.length - 1;
          const isHome = crumb.path === '/';
          const handleCrumbClick = (_item: unknown, e: React.MouseEvent) => {
            e.preventDefault();
            if (isHome) { navigateHome(); return; }
            if (crumb.path) { navigate(crumb.path); return; }
            if (crumb.menuChildren) {
              const leaf = findFirstLeafPath(crumb.menuChildren);
              if (leaf) navigate(leaf);
            }
          };
          const crumbInner = (
            <Space spacing={4}>
              {breadcrumbIcon && crumb.icon && <span style={{ display: 'flex', alignItems: 'center' }}>{renderLucideIcon(crumb.icon, 13)}</span>}
              {isHome ? '首页' : crumb.title}
            </Space>
          );
          const hasSubMenu = (breadcrumbSubMenu ?? false)
            && !isLast
            && !isHome
            && (crumb.menuChildren?.filter(c => c.visible && c.status === 'enabled').length ?? 0) > 0;
          const breadcrumbItem = (
            <Breadcrumb.Item
              key={crumb.title}
              href={isLast ? undefined : '#'}
              onClick={isLast || !(breadcrumbClickable ?? true) ? undefined : handleCrumbClick}
              noLink={isLast}
            >
              {crumbInner}
            </Breadcrumb.Item>
          );
          if (hasSubMenu) {
            const subItems = crumb.menuChildren!.filter(c => c.visible && c.status === 'enabled');
            return (
              <BreadcrumbMenuPopover
                key={`${crumb.title}:${pathname}`}
                onNavigate={(path) => navigate(path)}
                trigger={breadcrumbItem}
              >
                {subItems}
              </BreadcrumbMenuPopover>
            );
          }
          return breadcrumbItem;
        })}
      </Breadcrumb>
      {/* 收藏当前页按钮 */}
      {(showFavorites ?? false) && (() => {
        const currentMenu = flatMenus.find((m) => m.path === pathname);
        if (!currentMenu) return null;
        const faved = isFavorite(currentMenu.id);
        return (
          <Tooltip content={faved ? '取消收藏' : '收藏此页'} position="bottom">
            <button
              type="button"
              onClick={() => toggleFavorite(currentMenu.id)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, border: 0, borderRadius: 'var(--semi-border-radius-small)', background: 'transparent',
                cursor: 'pointer', flexShrink: 0, padding: 0,
                color: faved ? 'var(--semi-color-warning)' : 'var(--semi-color-text-2)',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { if (!faved) e.currentTarget.style.color = 'var(--semi-color-text-0)'; }}
              onMouseLeave={(e) => { if (!faved) e.currentTarget.style.color = 'var(--semi-color-text-2)'; }}
            >
              <Star size={14} fill={faved ? 'currentColor' : 'none'} strokeWidth={faved ? 0 : 1.8} />
            </button>
          </Tooltip>
        );
      })()}
    </div>
  );
}
