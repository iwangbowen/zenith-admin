import { requireRow } from '../../lib/db-assert';
import { buildWhere } from '../../lib/where-helpers';
import { eq, and, ne, asc, inArray, countDistinct } from 'drizzle-orm';
import { db } from '../../db';
import { menus, roleMenus, userMenus, roles } from '../../db/schema';
import { ADMIN_CONTEXT_ROUTES, PAGE_ROUTE_RULES, menuRoutePattern, type Menu } from '@zenith/shared/identity';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getEffectiveTenantId, isPlatformAdmin } from '../../lib/tenant';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { getTenantPackageFeatureSet } from '../../lib/tenant-package';
import { isSuperAdmin, getUserEffectiveAccess, notifyNavigationPermissionsChanged } from '../../lib/permissions';
import { formatTimestamps } from '../../lib/datetime';
import { buildTree } from '@zenith/shared/core';
import { isPageReadPermission } from '@zenith/shared/permission-features';
import { SEED_MENUS } from '@zenith/shared/seed/menus';
import { availableNavigation } from '../../lib/page-access';

const builtInPages = new Map(SEED_MENUS.filter(row => row.type === 'menu').map(row => [row.id, row]));

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
  type?: 'directory' | 'menu';
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

/** 全部启用页面路径；只暴露路径，用于 403/404 判别，不暴露权限码、按钮和组件。 */
export async function listMenuPaths(): Promise<string[]> {
  const user = currentUser();
  const [rows, features] = await Promise.all([
    db.select().from(menus),
    getTenantPackageFeatureSet(user.tenantId),
  ]);
  const available = availableNavigation(rows, features, isPlatformAdmin(user));
  const pageKeys = new Set(available.filter(row => row.type === 'menu').map(row => row.name));
  const patterns = available.flatMap(row => {
    const owner = PAGE_ROUTE_RULES[row.name ?? '']?.owner;
    return (!owner || pageKeys.has(owner)) ? menuRoutePattern(row) ?? [] : [];
  });
  const details = ADMIN_CONTEXT_ROUTES.filter(route =>
    (!route.owner || pageKeys.has(route.owner)) && (!route.feature || features === null || features.has(route.feature)));
  return [...new Set([...patterns, ...details.map(route => route.path)])];
}

/** 当前登录用户可见的菜单树 */
export async function listUserMenuTree(): Promise<Menu[]> {
  const user = currentUser();
  const superAdmin = isSuperAdmin(user);
  const [rows, featureSet, access] = await Promise.all([
    db.select().from(menus).orderBy(asc(menus.sort), asc(menus.id)),
    getTenantPackageFeatureSet(user.tenantId),
    superAdmin ? null : getUserEffectiveAccess(user.userId),
  ]);
  const navigation = availableNavigation(rows, featureSet, superAdmin);
  const ids = new Set(access?.menuIds ?? []);
  const codes = new Set(access?.permissions ?? []);
  const owners = new Map(navigation.flatMap(row => row.type === 'menu' && row.name ? [[row.name, row.id] as const] : []));
  const selected = navigation.filter(row => {
    if (row.type !== 'menu') return false;
    const rule = PAGE_ROUTE_RULES[row.name ?? ''];
    if (!rule) return superAdmin || ids.has(row.id);
    const owner = owners.get(rule.owner);
    return owner !== undefined && (superAdmin || ((ids.has(row.id) || ids.has(owner)) &&
      (!rule.anyPermission || rule.anyPermission.some(code => codes.has(code)))));
  });
  const byId = new Map(navigation.map(row => [row.id, row]));
  const included = new Set(selected.map(row => row.id));
  for (const row of selected) {
    let current = byId.get(row.parentId);
    while (current) {
      if (current.type === 'directory') included.add(current.id);
      current = byId.get(current.parentId);
    }
  }
  return buildMenuTree(navigation.filter(row => included.has(row.id)).map(row => {
    let parentId = row.parentId;
    while (parentId && !included.has(parentId)) parentId = byId.get(parentId)?.parentId ?? 0;
    return { ...mapMenu(row), parentId };
  }));
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

function assertMenuPermission(input: CreateMenuInput) {
  const type = input.type ?? 'menu';
  const permission = input.permission?.trim() || null;
  if (type === 'directory' && permission) throw new HTTPException(400, { message: '目录不能携带权限码' });
  if (permission && !Object.hasOwn(ALL_PERMISSIONS, permission)) throw new HTTPException(400, { message: `权限目录未登记 ${permission}` });
  if (type === 'menu' && permission && !isPageReadPermission(permission)) {
    throw new HTTPException(400, { message: '页面只能绑定页面读权限码，操作权限请在角色权限中单独授权' });
  }
}

async function assertMenuIdentityUnique(input: CreateMenuInput, currentId?: number) {
  const name = input.name?.trim();
  if (name) {
    const duplicate = await db.select({ id: menus.id }).from(menus)
      .where(buildWhere(eq(menus.name, name), currentId === undefined ? undefined : ne(menus.id, currentId)))
      .limit(1);
    if (duplicate.length) throw new HTTPException(400, { message: `菜单组件名 ${name} 已被占用` });
  }
  const path = input.path?.trim();
  if (path && (input.type ?? 'menu') === 'menu' && !input.isExternal) {
    const duplicate = await db.select({ id: menus.id }).from(menus)
      .where(buildWhere(
        eq(menus.path, path),
        eq(menus.type, 'menu'),
        eq(menus.isExternal, false),
        currentId === undefined ? undefined : ne(menus.id, currentId),
      ))
      .limit(1);
    if (duplicate.length) throw new HTTPException(400, { message: `页面路由 ${path} 已被占用` });
  }
}

export async function createMenu(input: CreateMenuInput): Promise<Omit<Menu, 'children'>> {
  assertMenuPermission(input);
  await assertMenuIdentityUnique(input);
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
  await notifyNavigationPermissionsChanged();
  return mapMenu(row);
}

export async function updateMenu(id: number, input: UpdateMenuInput): Promise<Omit<Menu, 'children'>> {
  const current = requireRow(await db.query.menus.findFirst({ where: eq(menus.id, id) }), '菜单不存在');
  if (current.type === 'menu' && input.name !== undefined && input.name !== current.name) {
    throw new HTTPException(400, { message: '页面标识创建后固定，请修改显示名称' });
  }
  if (builtInPages.has(id) && (['type', 'path', 'component', 'permission', 'isExternal'] as const).some(key =>
    input[key] !== undefined && input[key] !== current[key])) {
    throw new HTTPException(400, { message: '内置页面的路由、组件和读权限由代码定义' });
  }
  const merged = { ...current, ...input } as CreateMenuInput;
  assertMenuPermission(merged);
  await assertMenuIdentityUnique(merged, id);
  if (input.parentId !== undefined) {
    await ensureMenuParentValid(input.parentId, id);
  }
  const [row] = await db.update(menus).set({ ...input }).where(eq(menus.id, id)).returning();
  await notifyNavigationPermissionsChanged();
  return mapMenu(requireRow(row, '菜单不存在'));
}

/** 同一父级下的排序：orderedIds 必须覆盖全部直接子节点，避免拖拽造成部分排序。 */
export async function reorderMenus(parentId: number, orderedIds: number[]): Promise<{ count: number }> {
  const siblings = await db.select({ id: menus.id }).from(menus).where(eq(menus.parentId, parentId));
  const expected = new Set(siblings.map(row => row.id));
  const submitted = new Set(orderedIds);
  if (expected.size !== orderedIds.length || submitted.size !== orderedIds.length || [...expected].some(id => !submitted.has(id))) {
    throw new HTTPException(400, { message: '排序项必须包含该父级下的全部节点' });
  }
  await db.transaction(async (tx) => {
    for (let index = 0; index < orderedIds.length; index++) {
      await tx.update(menus).set({ sort: index }).where(eq(menus.id, orderedIds[index]));
    }
  });
  await notifyNavigationPermissionsChanged();
  return { count: orderedIds.length };
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
  await notifyNavigationPermissionsChanged();
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
