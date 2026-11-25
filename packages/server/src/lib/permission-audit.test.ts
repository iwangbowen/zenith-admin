/**
 * 权限清单对账测试（契约 access ↔ 权限注册表防漂移）
 *
 * 后端门禁引用的权限码全部来自契约操作的 `access` 声明，操作权限只存在于注册表和权限目录。
 * 这里断言每个被契约引用的权限码都能在 ALL_PERMISSIONS 中找到；页面读权限另外必须落在页面节点上。
 * 未注册的权限码除平台超管外**任何角色都无法获得**。
 *
 * 新增权限码的正确姿势：先在 packages/shared/src/{域}/permissions.ts 注册，
 * 再在契约操作的 `access` 中引用。
 */
import { describe, it, expect } from 'vitest';
import { accessPermissions } from '@zenith/shared/core';
import { listAllOperations } from '@zenith/shared/contracts';
import { ALL_PERMISSIONS } from '@zenith/shared/permissions';
import { SEED_MENUS } from '@zenith/shared/seed';

describe('权限清单对账（契约 access ↔ 权限注册表）', () => {
  it('契约 access 引用的每个权限码都必须在权限注册表声明', () => {
    const registered = new Set(Object.keys(ALL_PERMISSIONS));
    expect(registered.size).toBeGreaterThan(0);
    expect(SEED_MENUS.every(menu => menu.type === 'directory' || menu.type === 'menu')).toBe(true);

    const missing = new Map<string, string[]>();
    let referenced = 0;
    for (const { op } of listAllOperations()) {
      for (const code of accessPermissions(op.access)) {
        referenced++;
        if (!registered.has(code)) {
          const key = `${op.method.toUpperCase()} ${op.fullPath}`;
          missing.set(key, [...(missing.get(key) ?? []), code]);
        }
      }
    }
    expect(referenced).toBeGreaterThan(1000);

    const report = [...missing.entries()].map(([endpoint, codes]) => `  ${endpoint}: ${codes.join(', ')}`).join('\n');
    expect(
      missing.size,
      `以下契约操作引用的权限码未在权限注册表登记（请先在 packages/shared/src/{域}/permissions.ts 注册）：\n${report}`,
    ).toBe(0);
  });
  it('告警菜单使用独立顶级目录且不保留旧系统运维节点', () => {
    expect(SEED_MENUS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 15000, parentId: 0, title: '告警中心', type: 'directory', sort: 4 }),
      expect.objectContaining({ id: 15010, parentId: 15000, path: '/alerts/rules', component: 'alerts/rules/AlertRulesPage' }),
      expect.objectContaining({ id: 15020, parentId: 15000, path: '/alerts/events', component: 'alerts/events/AlertEventsPage' }),
    ]));
    expect(SEED_MENUS.some((menu) => [2550, 2551, 2552, 2553, 2554, 2560, 2561].includes(menu.id))).toBe(false);
    expect(SEED_MENUS.some((menu) => menu.permission?.startsWith('system:monitor:alert'))).toBe(false);
  });

  it('数据库备份并入数据库管理页，不保留独立菜单与 system:db-backup:* 权限码', () => {
    expect(SEED_MENUS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 2370, path: '/system/db-admin', component: 'system/db-admin/DbAdminPage' }),
    ]));
    expect(SEED_MENUS.some((menu) => menu.id >= 2110 && menu.id <= 2113)).toBe(false);
    expect(SEED_MENUS.some((menu) => menu.path === '/system/db-backups')).toBe(false);
    expect(SEED_MENUS.some((menu) => menu.permission?.startsWith('system:db-backup:'))).toBe(false);
  });
});
