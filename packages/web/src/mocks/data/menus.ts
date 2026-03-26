import type { Menu } from '@zenith/shared';
import { SEED_MENUS } from '@zenith/shared';

export const mockMenus: Menu[] = SEED_MENUS.map((m) => ({ ...m }));

let nextMenuId = 300;
export function getNextMenuId() {
  return nextMenuId++;
}

/** 将平铺列表转换为树形结构 */
export function buildMenuTree(items: Menu[]): Menu[] {
  const map = new Map<number, Menu>();
  items.forEach((m) => map.set(m.id, { ...m, children: [] }));
  const roots: Menu[] = [];
  map.forEach((item) => {
    if (item.parentId === 0) {
      roots.push(item);
    } else {
      const parent = map.get(item.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(item);
      }
    }
  });
  const sortFn = (a: Menu, b: Menu) => a.sort - b.sort;
  const sortTree = (nodes: Menu[]) => {
    nodes.sort(sortFn);
    nodes.forEach((n) => n.children && sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}
