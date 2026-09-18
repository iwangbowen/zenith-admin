import { useCallback, useEffect, useMemo } from 'react';
import type { Menu } from '@zenith/shared/identity';
import type { FlatMenuItem } from '@/components/MenuSearchInput';
import type { NavLayout } from '@/hooks/usePreferences';
import { useLucideIconsReady } from '@/utils/icons';
import { menuToNavItem, findAncestorKeys, findBreadcrumbs, type NavItem, type BreadcrumbData } from './utils';

export function useFlatMenus(menuTree: Menu[]) {
  const flatMenus = useMemo<FlatMenuItem[]>(() => {
    const result: FlatMenuItem[] = [];
    const walk = (nodes: Menu[], parents: string[]) => {
      for (const node of nodes) {
        if (node.type === 'menu' && node.path && node.status === 'enabled' && node.visible) {
          // 外链内嵌菜单的实际访问路径是内部路由 /embed/{id}（页签/搜索/收藏按此匹配）
          const path = node.isExternal && node.embed ? `/embed/${node.id}` : node.path;
          result.push({ id: node.id, title: node.title, path, icon: node.icon, breadcrumb: parents });
        }
        if (node.children?.length) walk(node.children, node.type === 'directory' ? [...parents, node.title] : parents);
      }
    };
    walk(menuTree, []);
    return result;
  }, [menuTree]);
  return flatMenus;
}

export function useBreadcrumbData(menuTree: Menu[], pathname: string, breadcrumbShowHome: boolean | undefined) {
  const currentSectionKeys = useMemo(
    () => findAncestorKeys(menuTree, pathname),
    [menuTree, pathname]
  );

  const breadcrumbs = useMemo(
    () => findBreadcrumbs(menuTree, pathname),
    [menuTree, pathname]
  );
  const displayBreadcrumbs = useMemo<BreadcrumbData[]>(() => {
    if ((breadcrumbShowHome ?? true) && pathname !== '/') {
      // 找到首页菜单的图标（findBreadcrumbs 不包含首页）
      const findHomeIcon = (nodes: Menu[]): string | undefined => {
        for (const node of nodes) {
          if (!node.visible || node.type === 'button') continue;
          if (node.type === 'directory' && node.children?.length) {
            const icon = findHomeIcon(node.children);
            if (icon) return icon;
          } else if (node.path === '/') {
            return node.icon ?? undefined;
          }
        }
        return undefined;
      };
      return [{ title: '首页', path: '/', icon: findHomeIcon(menuTree) }, ...breadcrumbs];
    }
    return breadcrumbs;
  }, [breadcrumbs, breadcrumbShowHome, pathname, menuTree]);

  return { currentSectionKeys, displayBreadcrumbs };
}

export function useNavItems(menuTree: Menu[], chatUnreadCount: number) {
  const iconsReady = useLucideIconsReady();
  // 深层转换（递归遍历整棵菜单树 + 为每个节点创建图标元素）只依赖菜单本身。
  // 聊天未读数每来一条消息就变，若与此处合并会导致整棵导航树被重建。
  const baseNavItems = useMemo(
    () => menuTree.map(menuToNavItem).filter((item): item is NavItem => item !== null),
    // iconsReady: 图标注册表异步加载完成后重建 nav 项以补齐菜单图标
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menuTree, iconsReady]
  );

  // 未读徽标只影响顶层 /chat 一项，浅层重建即可；无未读时直接透传保持引用不变
  const navItems = useMemo(() => {
    if (chatUnreadCount <= 0) return baseNavItems;
    if (!baseNavItems.some((item) => item.itemKey === '/chat')) return baseNavItems;
    return baseNavItems.map((item) => (
      item.itemKey === '/chat'
        ? { ...item, badge: { count: chatUnreadCount, overflowCount: 99 } }
        : item
    ));
  }, [baseNavItems, chatUnreadCount]);

  return navItems;
}

export function useMenuMaps(menuTree: Menu[]) {
  const pathMetaMap = useMemo(() => {
    const map = new Map<string, { title: string; icon?: string }>([
      ['/search', { title: '统一搜索', icon: 'Search' }],
    ]);
    function traverse(nodes: Menu[]) {
      for (const node of nodes) {
        if (node.path && node.title) map.set(node.path, { title: node.title, icon: node.icon ?? undefined });
        if (node.children) traverse(node.children);
      }
    }
    traverse(menuTree);
    return map;
  }, [menuTree]);

  /**
   * 路径 → 菜单元信息。
   *
   * 带动态参数的页面（`/workflow/designer/1`）在菜单中只登记了父路径，需前缀回退；
   * 且必须取**最长**前缀——`/workflow/forms/designer/5` 同时匹配「表单库」`/workflow/forms`
   * 与「表单设计」`/workflow/forms/designer`，按遍历顺序取首个会命中父级菜单。
   */
  const resolveMeta = useCallback((pathname: string) => {
    const exact = pathMetaMap.get(pathname);
    if (exact) return exact;
    let best: { title: string; icon?: string } | undefined;
    let bestLength = -1;
    for (const [path, meta] of pathMetaMap) {
      if (path.length > bestLength && pathname.startsWith(`${path}/`)) {
        best = meta;
        bestLength = path.length;
      }
    }
    return best;
  }, [pathMetaMap]);

  const resolveTitle = useCallback(
    (pathname: string) => resolveMeta(pathname)?.title ?? pathname,
    [resolveMeta],
  );

  /** 页签图标：与标题同一套匹配规则，否则动态参数页面会缺图标 */
  const resolveIcon = useCallback(
    (pathname: string) => resolveMeta(pathname)?.icon,
    [resolveMeta],
  );

  return { resolveTitle, resolveIcon };
}

export function useAutoTopKey(
  navLayout: NavLayout,
  navItems: NavItem[],
  pathname: string,
  setManualTopKey: (key: string | null) => void,
) {
  const autoTopKey = useMemo(() => {
    if (navLayout !== 'mixed' && navLayout !== 'double') return null;
    function contains(items: NavItem[], path: string): boolean {
      return items.some((item) =>
        item.itemKey === path || (item.items ? contains(item.items, path) : false),
      );
    }
    for (const item of navItems) {
      if (contains([item], pathname)) return item.itemKey;
    }
    return navItems[0]?.itemKey ?? null;
  }, [navLayout, navItems, pathname]);

  useEffect(() => {
    if ((navLayout === 'mixed' || navLayout === 'double') && autoTopKey) setManualTopKey(autoTopKey);
  }, [navLayout, autoTopKey, setManualTopKey]);

  return autoTopKey;
}

export function useMixedNavItems(navLayout: NavLayout, navItems: NavItem[], effectiveTopKey: string | null) {
  const mixedTopNavItems = useMemo(
    // 保留 badge 字段：mixed 顶栏由 TopNavWithOverflow 渲染徽标（如聊天未读）
    () => navItems.map(({ itemKey, text, icon, isExternal, badge }) => ({ itemKey, text, icon, isExternal, badge })),
    [navItems],
  );

  const mixedSidebarItems = useMemo(() => {
    if (navLayout !== 'mixed') return [];
    const top = navItems.find((i) => i.itemKey === effectiveTopKey);
    return top?.items ?? [];
  }, [navLayout, navItems, effectiveTopKey]);

  const doubleSubItems = useMemo(() => {
    if (navLayout !== 'double') return [];
    const top = navItems.find((i) => i.itemKey === effectiveTopKey);
    return top?.items ?? [];
  }, [navLayout, navItems, effectiveTopKey]);

  return { mixedTopNavItems, mixedSidebarItems, doubleSubItems };
}

// 页面缓存白名单：菜单开启 keepAlive 的路径（外链内嵌菜单取内部路由 /embed/{id}）
export function useKeepAlivePaths(menuTree: Menu[]) {
  const keepAlivePaths = useMemo(() => {
    const result = new Set<string>();
    const walk = (nodes: Menu[]) => {
      for (const node of nodes) {
        if (node.type === 'menu' && node.keepAlive && node.path && node.status === 'enabled') {
          if (node.isExternal) {
            if (node.embed) result.add(`/embed/${node.id}`);
          } else {
            result.add(node.path);
          }
        }
        if (node.children?.length) walk(node.children);
      }
    };
    walk(menuTree);
    return result;
  }, [menuTree]);
  return keepAlivePaths;
}
