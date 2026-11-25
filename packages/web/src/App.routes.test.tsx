/**
 * 路由注册策略回归（SSL 授权缺口修复的防回潮护栏）
 *
 * 背景：/system/ssl-certificates 曾同时存在「无守卫的硬编码 Route」与
 * 「权限过滤的动态菜单 Route」。React Router 对同一静态路径按声明顺序取先者，
 * 硬编码版本必然遮蔽动态版本——未授权用户可直接打开页面。
 * 修复后该页面只能由 /api/menus/user 树承载，未授权访问落 catch-all 403。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Menu } from '@zenith/shared/identity';
import { FIXED_ROUTES, flattenMenus, buildAllMenuPaths } from './App';

const SSL_PATH = '/system/ssl-certificates';

function menu(partial: Partial<Menu> & Pick<Menu, 'id' | 'title'>): Menu {
  return { parentId: 0, type: 'menu', status: 'enabled', visible: true, sort: 0, createdAt: '', updatedAt: '', ...partial } as Menu;
}

const MENU_TREE: Menu[] = [
  menu({
    id: 2440,
    title: '运维管理',
    type: 'directory',
    children: [
      menu({ id: 2590, parentId: 2440, title: 'SSL 证书', path: SSL_PATH, component: 'system/ssl-certificates/SslCertificatesPage' }),
      menu({ id: 2591, parentId: 2590, title: '证书详情', type: 'menu', path: '/system/ssl/detail', permission: 'system:ssl:view' }),
    ],
  }),
  // 隐藏工具页：不进侧边栏但必须注册路由
  menu({ id: 11, title: '个人中心', path: '/profile', component: 'profile/ProfilePage', visible: false }),
];

describe('SSL 证书页面只能由动态菜单承载', () => {
  it('is not a fixed route and has no hardcoded registration in App.tsx', () => {
    expect(FIXED_ROUTES.has(SSL_PATH)).toBe(false);

    // 防回潮：重新引入硬编码注册会遮蔽动态菜单的权限过滤（vitest cwd = packages/web）
    const source = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(source).not.toMatch(/path="system\/ssl-certificates"/);
  });

  it('registers from the user menu tree when authorized', () => {
    const routes = flattenMenus(MENU_TREE);
    expect(routes.map((m) => m.path)).toContain(SSL_PATH);
  });

  it('is discriminated as 403 (not 404) for unauthorized users via the management tree', () => {
    // catch-all 用管理树判别：路径存在但用户菜单未注册 → 403
    const allPaths = buildAllMenuPaths(MENU_TREE);
    expect(allPaths.get(SSL_PATH)).toBe('system/ssl-certificates/SslCertificatesPage');
  });
});

describe('flattenMenus 注册规则', () => {
  it('skips fixed routes to avoid double registration', () => {
    const routes = flattenMenus(MENU_TREE);
    expect(routes.map((m) => m.path)).not.toContain('/profile');
  });

  it('skips nodes without path or component', () => {
    const routes = flattenMenus(MENU_TREE);
    const ids = routes.map((m) => m.id);
    expect(ids).not.toContain(2440); // 目录无 component
    expect(ids).not.toContain(2591); // 按钮是纯权限点
  });
});
