import type { AccessWorkflowOptions, Menu, PermissionCatalog } from '@zenith/shared/identity';
import { buildTree } from '@zenith/shared/core';
import type { PermissionScopeData, PermissionScopeItem } from './scope-types';

function pageTitleMap(menus: readonly AccessWorkflowOptions['menus'][number][]): Map<number, string> {
  return new Map(menus.filter(menu => menu.type !== 'permission').map(menu => [menu.id, menu.title]));
}

/**
 * 管理端（角色 / 用户直授权）：菜单树来自菜单接口，操作权限来自只读权限目录。
 */
export function createAdminScopeData(menuTree: Menu[], catalog: PermissionCatalog): PermissionScopeData {
  const permissions: PermissionScopeItem[] = catalog.items.map((item) => ({
    code: item.code,
    label: item.label,
    pageId: item.pageId,
    pageTitle: item.pageTitle,
    path: item.path ? item.path.split('/').filter(Boolean) : [],
    surface: item.surface,
    requestable: true,
    uiOnly: item.uiOnly,
  }));
  return { pages: menuTree, permissions };
}

/**
 * 权限申请：AccessWorkflowOptions 本身已经包含页面树和可申请操作权限节点。
 * 页面树只取 directory / menu，操作权限同时保留页面读权限（用于 API-only 申请）。
 */
export function createAccessScopeData(optionsMenus: readonly AccessWorkflowOptions['menus'][number][]): PermissionScopeData {
  const pages = buildTree<Menu>(optionsMenus
    .filter(menu => menu.type !== 'permission')
    .map(menu => ({
      id: menu.id,
      parentId: menu.parentId,
      title: menu.title,
      name: menu.name ?? undefined,
      path: menu.path.join(' / '),
      type: menu.type,
      permission: menu.permission ?? undefined,
      sort: 0,
      status: 'enabled' as const,
      visible: true,
      createdAt: '',
      updatedAt: '',
    })) as unknown as Menu[]);
  const titles = pageTitleMap(optionsMenus);
  const permissions: PermissionScopeItem[] = optionsMenus.flatMap((menu) => {
    if (!menu.permission) return [];
    const pageId = menu.type === 'permission' ? menu.parentId : menu.id;
    return [{
      code: menu.permission,
      label: menu.type === 'permission' ? menu.title : menu.permissionLabel ?? '页面读权限',
      pageId,
      pageTitle: titles.get(pageId) ?? null,
      path: menu.path,
      surface: menu.type === 'permission' ? 'operation' : 'page',
      requestable: menu.requestable,
      riskLevel: menu.riskLevel,
      approvalPolicy: menu.approvalPolicy,
    }];
  });
  return { pages, permissions };
}

/** 只把某一页面的页面读权限和操作权限拿出来，供菜单管理的只读抽屉使用。 */
export function filterScopeDataByPage(data: PermissionScopeData, pageId: number): PermissionScopeData {
  return {
    pages: data.pages,
    permissions: data.permissions.filter(item => item.pageId === pageId),
  };
}
