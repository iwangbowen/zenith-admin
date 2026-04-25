import { eq, asc } from 'drizzle-orm';
import { db } from '../db';
import { menus } from '../db/schema';
import type { Menu } from '@zenith/shared';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';
import { isSuperAdmin, getUserMenuIds } from '../lib/permissions';
import { formatDateTime } from '../lib/datetime';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapMenu(row: typeof menus.$inferSelect): Omit<Menu, 'children'> {
  return {
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    name: row.name ?? undefined,
    path: row.path ?? undefined,
    component: row.component ?? undefined,
    icon: row.icon ?? undefined,
    type: row.type,
    permission: row.permission ?? undefined,
    sort: row.sort,
    status: row.status,
    visible: row.visible,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 树形结构构建 ─────────────────────────────────────────────────────────────

export function buildMenuTree(list: Omit<Menu, 'children'>[]): Menu[] {
  const map = new Map<number, Menu>();
  list.forEach((item) => map.set(item.id, { ...item }));
  const roots: Menu[] = [];
  map.forEach((node) => {
    if (node.parentId === 0) {
      roots.push(node);
    } else {
      const parent = map.get(node.parentId);
      if (parent) {
        parent.children = parent.children ?? [];
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  });
  const sortNodes = (nodes: Menu[]) => {
    nodes.sort((a, b) => a.sort - b.sort);
    nodes.forEach((n) => n.children && sortNodes(n.children));
  };
  sortNodes(roots);
  return roots;
}

// ─── 输入类型 ─────────────────────────────────────────────────────────────────

export interface CreateMenuInput {
  parentId?: number;
  title: string;
  name?: string;
  path?: string;
  component?: string;
  icon?: string;
  type?: 'directory' | 'menu' | 'button';
  permission?: string;
  sort?: number;
  status?: 'active' | 'disabled';
  visible?: boolean;
}
export type UpdateMenuInput = Partial<CreateMenuInput>;

// ─── 业务方法 ─────────────────────────────────────────────────────────────────

/** 当前登录用户可见的菜单树 */
export async function listUserMenuTree(): Promise<Menu[]> {
  const user = currentUser();
  const allMenus = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));

  if (isSuperAdmin(user.roles)) {
    return buildMenuTree(allMenus.map(mapMenu));
  }

  const allowedMenuIds = new Set(await getUserMenuIds(user.userId));
  const idToMenu = new Map(allMenus.map((m) => [m.id, m]));
  for (const id of new Set(allowedMenuIds)) {
    let current = idToMenu.get(id);
    while (current && current.parentId !== 0) {
      if (allowedMenuIds.has(current.parentId)) break;
      allowedMenuIds.add(current.parentId);
      current = idToMenu.get(current.parentId);
    }
  }

  const filtered = allMenus.filter((m) => allowedMenuIds.has(m.id) || !m.visible);
  return buildMenuTree(filtered.map(mapMenu));
}

export async function listMenuTree(): Promise<Menu[]> {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return buildMenuTree(list.map(mapMenu));
}

export async function listMenusFlat(): Promise<Omit<Menu, 'children'>[]> {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return list.map(mapMenu);
}

export async function createMenu(input: CreateMenuInput): Promise<Omit<Menu, 'children'>> {
  const [row] = await db
    .insert(menus)
    .values({
      parentId: input.parentId ?? 0,
      title: input.title,
      name: input.name,
      path: input.path,
      component: input.component,
      icon: input.icon,
      type: input.type ?? 'menu',
      permission: input.permission,
      sort: input.sort ?? 0,
      status: input.status ?? 'active',
      visible: input.visible ?? true,
    })
    .returning();
  return mapMenu(row);
}

export async function updateMenu(id: number, input: UpdateMenuInput): Promise<Omit<Menu, 'children'>> {
  const [row] = await db.update(menus).set({ ...input }).where(eq(menus.id, id)).returning();
  if (!row) throw new AppError('菜单不存在', 404);
  return mapMenu(row);
}

export async function deleteMenu(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    const all = await tx.select({ id: menus.id, parentId: menus.parentId }).from(menus);
    const toDelete = new Set<number>();
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      toDelete.add(cur);
      all.filter((m) => m.parentId === cur).forEach((m) => queue.push(m.id));
    }
    for (const mid of toDelete) {
      await tx.delete(menus).where(eq(menus.id, mid));
    }
  });
}
