import { requireRow } from '../../lib/db-assert';
import { eq, and, ne, asc, inArray, countDistinct } from 'drizzle-orm';
import { db } from '../../db';
import { menus, roleMenus, userMenus, roles } from '../../db/schema';
import type { Menu } from '@zenith/shared/identity';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getEffectiveTenantId } from '../../lib/tenant';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { isSuperAdmin, getUserMenuIds } from '../../lib/permissions';
import { formatTimestamps } from '../../lib/datetime';
import { buildTree } from '@zenith/shared/core';

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
    query: row.query ?? null,
    isExternal: row.isExternal,
    embed: row.embed,
    keepAlive: row.keepAlive,
    sort: row.sort,
    status: row.status,
    visible: row.visible,
    featureKey: row.featureKey,
    ...formatTimestamps(row),
  };
}

// ─── 树形结构构建 ─────────────────────────────────────────────────────────────

/**
 * 剔除自身或任一祖先处于禁用状态的菜单。
 * 若只过滤禁用节点自身，其仍为 enabled 的子节点会因找不到父级而被 buildMenuTree 提升为根节点，
 * 导致禁用目录下的页面「上浮」到侧边栏一级；禁用目录的语义是整棵子树对用户不可见。
 * 父级缺失（孤儿节点）不在此处理，沿用 buildMenuTree 的既有行为。
 */
export function excludeDisabledSubtrees<T extends Pick<Menu, 'id' | 'parentId' | 'status'>>(rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const isEffectivelyEnabled = (row: T): boolean => {
    const visited = new Set<number>();
    let current: T | undefined = row;
    while (current) {
      if (current.status !== 'enabled') return false;
      if (current.parentId === 0 || visited.has(current.id)) return true;
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
    return true;
  };
  return rows.filter(isEffectivelyEnabled);
}

/** 同层 visible=true 的菜单排在前面，其后按 sort */
export function buildMenuTree(list: Omit<Menu, 'children'>[]): Menu[] {
  return buildTree<Menu>(list, {
    compare: (a, b) => (a.visible !== b.visible ? (a.visible ? -1 : 1) : a.sort - b.sort),
  });
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
  query?: string | null;
  isExternal?: boolean;
  embed?: boolean;
  keepAlive?: boolean;
  sort?: number;
  status?: 'enabled' | 'disabled';
  visible?: boolean;
}
export type UpdateMenuInput = Partial<CreateMenuInput>;

// ─── 业务校验 ─────────────────────────────────────────────────────────────────

/** 校验父级菜单：存在性 +（更新时）自身/子孙环引用防护 */
async function ensureMenuParentValid(parentId: number, currentId?: number) {
  if (parentId === 0) return;
  const allMenus = await db.select({ id: menus.id, parentId: menus.parentId }).from(menus);
  if (!allMenus.some((m) => m.id === parentId)) throw new HTTPException(400, { message: '父级菜单不存在' });
  if (currentId === undefined) return;
  if (parentId === currentId) throw new HTTPException(400, { message: '父级菜单不能选择自身' });
  const descendants = new Set<number>();
  const queue = [currentId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const item of allMenus) {
      if (item.parentId === current && !descendants.has(item.id)) { descendants.add(item.id); queue.push(item.id); }
    }
  }
  if (descendants.has(parentId)) throw new HTTPException(400, { message: '父级菜单不能选择自身的子菜单' });
}

// ─── 业务方法 ─────────────────────────────────────────────────────────────────

/** 当前登录用户可见的菜单树 */
export async function listUserMenuTree(): Promise<Menu[]> {
  const user = currentUser();
  // 禁用菜单（含其整棵子树）对所有人（含超管）不可见，前端不再注册禁用路由；菜单管理页走 listMenuTree 不受影响
  // 按钮型节点是纯操作权限点（权限码经登录态下发），不参与页面/侧边栏展示
  const allMenus = excludeDisabledSubtrees(await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id)))
    .filter((m) => m.type !== 'button');

  if (isSuperAdmin(user)) {
    return buildMenuTree(allMenus.map(mapMenu));
  }

  // 菜单显示与操作权限解耦：仅分配了按钮（如「查询」）不会带出其所属页面；
  // 祖先补全只从已分配的目录/页面节点出发，用于侧边栏分组路径完整。
  const assignedIds = await getUserMenuIds(user.userId);
  const idToMenu = new Map(allMenus.map((m) => [m.id, m]));
  const allowedMenuIds = new Set(assignedIds.filter((id) => idToMenu.has(id)));
  for (const id of [...allowedMenuIds]) {
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
  // 多租户：租户管理员（或平台超管切换至某租户视角）分配角色菜单时，可选范围限定在套餐功能内。
  const featureSet = await getTenantPackageFeatureSet(getEffectiveTenantId(currentUser()));
  const filtered = featureSet ? list.filter((m) => !m.featureKey || featureSet.has(m.featureKey)) : list;
  return buildMenuTree(filtered.map(mapMenu));
}

export async function listMenusFlat(): Promise<Omit<Menu, 'children'>[]> {
  const list = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  return list.map(mapMenu);
}

export async function createMenu(input: CreateMenuInput): Promise<Omit<Menu, 'children'>> {
  await ensureMenuParentValid(input.parentId ?? 0);
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
      query: input.query ?? null,
      isExternal: input.isExternal ?? false,
      embed: input.embed ?? false,
      keepAlive: input.keepAlive ?? false,
      sort: input.sort ?? 0,
      status: input.status ?? 'enabled',
      visible: input.visible ?? true,
    })
    .returning();
  return mapMenu(row);
}

export async function updateMenu(id: number, input: UpdateMenuInput): Promise<Omit<Menu, 'children'>> {
  if (input.parentId !== undefined) {
    await ensureMenuParentValid(input.parentId, id);
  }
  const [row] = await db.update(menus).set({ ...input }).where(eq(menus.id, id)).returning();
  return mapMenu(requireRow(row, '菜单不存在'));
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
    const ids = [...toDelete];
    // 在用保护：被角色（超管的全量绑定除外）或用户直接授权引用的菜单不允许删除
    const [[roleRef], [userRef]] = await Promise.all([
      tx.select({ count: countDistinct(roleMenus.roleId) })
        .from(roleMenus)
        .innerJoin(roles, eq(roles.id, roleMenus.roleId))
        .where(and(inArray(roleMenus.menuId, ids), ne(roles.code, 'super_admin'))),
      tx.select({ count: countDistinct(userMenus.userId) })
        .from(userMenus)
        .where(inArray(userMenus.menuId, ids)),
    ]);
    const roleCount = Number(roleRef?.count ?? 0);
    const userCount = Number(userRef?.count ?? 0);
    if (roleCount > 0 || userCount > 0) {
      const parts = [
        roleCount > 0 ? `${roleCount} 个角色` : null,
        userCount > 0 ? `${userCount} 个用户` : null,
      ].filter(Boolean).join('、');
      throw new HTTPException(409, { message: `该菜单（含子菜单）仍被 ${parts} 授权引用，请先解除授权后再删除` });
    }
    await tx.delete(menus).where(inArray(menus.id, ids));
  });
}

export async function getMenu(id: number) {
  const [row] = await db.select().from(menus).where(eq(menus.id, id)).limit(1);
  return mapMenu(requireRow(row, '菜单不存在'));
}

export async function getMenuBeforeAudit(id: number) {
  const [row] = await db.select().from(menus).where(eq(menus.id, id)).limit(1);
  if (!row) return null;
  return mapMenu(row);
}

export async function getMenuCascadeBeforeAudit(id: number) {
  const all = await db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id));
  const toDelete = new Set<number>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    toDelete.add(cur);
    all.filter((menu) => menu.parentId === cur).forEach((menu) => queue.push(menu.id));
  }
  const rows = all.filter((menu) => toDelete.has(menu.id));
  if (rows.length === 0) return null;
  return rows.map(mapMenu);
}
