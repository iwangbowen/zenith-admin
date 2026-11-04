import { Badge } from '@douyinfe/semi-ui';
import type { Menu } from '@zenith/shared/identity';
import type { InAppMessage, Announcement } from '@zenith/shared/messaging';
import { renderLucideIcon } from '@/utils/icons';

export function getMenuIcon(iconName?: string): React.ReactNode {
  const icon = renderLucideIcon(iconName ?? 'LayoutGrid') ?? renderLucideIcon('LayoutGrid');
  return <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>;
}

/** 菜单栏会对长标题省略；保留完整 title 供悬浮查看。 */
function menuTitle(title: string): React.ReactNode {
  return <span className="admin-nav-item-title" title={title}>{title}</span>;
}

// 提取为模块级函数，避免组件内嵌套函数超过 4 层
export const updateMessageRead = (id: number) => (prev: InAppMessage[]) =>
  prev.map((m) => (m.id === id ? { ...m, isRead: true } : m));
export const updateMessageReadIfUnread = (id: number) => (prev: InAppMessage[]) =>
  prev.map((m) => (m.id === id && !m.isRead ? { ...m, isRead: true } : m));
export const markAllMessagesRead = (prev: InAppMessage[]) =>
  prev.map((m) => (m.isRead ? m : { ...m, isRead: true }));
export const removeMessageById = (id: number) => (prev: InAppMessage[]) =>
  prev.filter((m) => m.id !== id);
export const markAnnouncementRead = (id: number) => (prev: (Announcement & { isRead: boolean })[]) =>
  prev.map((a) => (a.id === id ? { ...a, isRead: true } : a));

/**
 * WebSocket 推送的新消息写入铃铛列表：按 id 去重（多标签页 / 多进程重复投递），头插并裁到首页大小。
 * 返回 null 表示已存在、无需改动（调用方据此决定是否累加未读数）。
 */
export function prependUnique<T extends { id: number }>(prev: T[], item: T, limit: number): T[] | null {
  if (prev.some((m) => m.id === item.id)) return null;
  return [item, ...prev].slice(0, limit);
}

export interface TabClosableFlags {
  hasClosableLeft: boolean;
  hasClosableRight: boolean;
  hasClosableOthers: boolean;
  hasAnyClosable: boolean;
}

/**
 * 计算每个页签的「关闭左侧 / 右侧 / 其他 / 全部」可用性。
 *
 * 一次 O(n) 前缀扫描得出全部结果，替代在渲染循环里对每个页签重复
 * `slice().some()` 的 O(n²) 写法。
 */
export function computeTabClosableFlags<T extends { closable: boolean }>(
  tabs: readonly T[],
): TabClosableFlags[] {
  // closableBefore[i] = 下标 i 之前可关闭页签的数量
  const closableBefore: number[] = [];
  let seen = 0;
  for (const tab of tabs) {
    closableBefore.push(seen);
    if (tab.closable) seen += 1;
  }
  const total = seen;
  return tabs.map((tab, i) => {
    const left = closableBefore[i];
    const self = tab.closable ? 1 : 0;
    return {
      hasClosableLeft: left > 0,
      hasClosableRight: total - left - self > 0,
      hasClosableOthers: total - self > 0,
      hasAnyClosable: total > 0,
    };
  });
}

export type NavItem = {
  itemKey: string;
  text: React.ReactNode;
  icon?: React.ReactNode;
  items?: NavItem[];
  badge?: { count: number; overflowCount?: number };
  isExternal?: boolean;
  /** 菜单配置的默认路由参数（querystring，不含 `?`），跳转时拼接到 path */
  query?: string | null;
};

/** 未读数徽标拼到导航文字后（Badge 独立使用形态，Semi 官方推荐无 children 时单独渲染） */
export function decorateBadgeText(text: React.ReactNode, badge?: NavItem['badge']): React.ReactNode {
  if (!badge || badge.count <= 0) return text;
  return (
    <span className="admin-nav-badge-text">
      <span>{text}</span>
      <Badge count={badge.count} overflowCount={badge.overflowCount ?? 99} type="danger" />
    </span>
  );
}

function hasAnyBadge(items: NavItem[]): boolean {
  return items.some(
    (item) => (item.badge != null && item.badge.count > 0) || (item.items ? hasAnyBadge(item.items) : false),
  );
}

/**
 * 把 NavItem 的自定义 badge 字段装饰进 Semi Nav 可识别的 text / icon：
 * 展开态在文字旁显示数字徽标；收起态（仅图标可见）改为图标右上角红点，
 * text 保持原样以免收起 Tooltip 内出现徽标。无徽标时原样返回，保持引用稳定（Nav FAQ：items 引用变化会重建导航）。
 */
export function decorateNavItemsWithBadges(items: NavItem[], collapsed = false): NavItem[] {
  if (!hasAnyBadge(items)) return items;
  return items.map((item) => {
    const next: NavItem = { ...item };
    // 收起态仅作用于顶层；子项在收起态经飞出菜单展示文字，仍走文字徽标
    if (item.items?.length) next.items = decorateNavItemsWithBadges(item.items, false);
    if (item.badge && item.badge.count > 0) {
      if (collapsed && item.icon) {
        next.icon = (
          <Badge dot type="danger">
            {item.icon}
          </Badge>
        );
      } else {
        next.text = decorateBadgeText(item.text, item.badge);
      }
    }
    return next;
  });
}

export function menuToNavItem(menu: Menu): NavItem | null {
  if (!menu.visible || menu.type === 'button') return null;
  const icon = getMenuIcon(menu.icon);
  if (menu.type === 'directory') {
    const children = (menu.children ?? [])
      .map(menuToNavItem)
      .filter((item): item is NavItem => item !== null);
    return { itemKey: menu.name ?? `dir-${menu.id}`, text: menuTitle(menu.title), icon, items: children };
  }
  // 外链内嵌：转为内部路由 /embed/{id}，走正常导航（iframe 打开）；非内嵌外链保持新窗口
  if (menu.isExternal && menu.embed) {
    return { itemKey: `/embed/${menu.id}`, text: menuTitle(menu.title), icon, isExternal: false };
  }
  return { itemKey: menu.path ?? `menu-${menu.id}`, text: menuTitle(menu.title), icon, isExternal: menu.isExternal ?? false, query: menu.query ?? null };
}

export function findNavItemAncestorKeys(items: NavItem[], targetKey: string): string[] | null {
  for (const item of items) {
    if (item.itemKey === targetKey) return [];
    if (item.items?.length) {
      const found = findNavItemAncestorKeys(item.items, targetKey);
      if (found !== null) return [item.itemKey, ...found];
    }
  }
  return null;
}

// 返回 null 表示路径不在菜单树中（如详情页）；返回 [] 表示命中顶级菜单项（无祖先目录）
export function findAncestorKeys(menuTree: Menu[], targetPath: string): string[] | null {
  function traverse(nodes: Menu[], ancestors: string[]): string[] | null {
    for (const node of nodes) {
      if (!node.visible || node.type === 'button') continue;
      if (node.type === 'directory') {
        const key = node.name ?? `dir-${node.id}`;
        const found = traverse(node.children ?? [], [...ancestors, key]);
        if (found !== null) return found;
      } else if (node.path === targetPath) {
        return ancestors;
      }
    }
    return null;
  }
  return traverse(menuTree, []);
}

export interface BreadcrumbData {
  title: string;
  path?: string;
  icon?: string;
  menuChildren?: Menu[];
}

export function findFirstLeafPath(children: Menu[]): string | null {
  for (const child of children) {
    if (!child.visible || child.type === 'button') continue;
    if (child.type === 'directory') {
      const leaf = findFirstLeafPath(child.children ?? []);
      if (leaf) return leaf;
    } else if (child.path) {
      return child.path;
    }
  }
  return null;
}

export function findBreadcrumbs(menuTree: Menu[], targetPath: string): BreadcrumbData[] {
  function traverse(nodes: Menu[], ancestors: BreadcrumbData[]): BreadcrumbData[] | null {
    for (const node of nodes) {
      if (!node.visible || node.type === 'button') continue;
      if (node.type === 'directory') {
        const found = traverse(node.children ?? [], [...ancestors, { title: node.title, icon: node.icon ?? undefined, menuChildren: node.children ?? [] }]);
        if (found !== null) return found;
      } else if (node.path === targetPath) {
        return [...ancestors, { title: node.title, path: node.path ?? undefined, icon: node.icon ?? undefined }];
      }
    }
    return null;
  }
  return traverse(menuTree, []) ?? [];
}
