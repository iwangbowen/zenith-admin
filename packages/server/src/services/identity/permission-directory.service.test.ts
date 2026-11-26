import { describe, expect, it } from 'vitest';
import { permissionCatalogSchema } from '@zenith/shared/identity';
import { buildPermissionDirectory } from '@zenith/shared/permission-features';
import { SEED_MENUS } from '@zenith/shared/seed/menus';

const directory = buildPermissionDirectory(SEED_MENUS);

describe('permission directory page bindings', () => {
  it('returns all pages for a shared permission', () => {
    const item = directory.items.find((entry) => entry.code === 'cms:site:list');

    expect(item?.surface).toBe('page');
    expect(item?.pageBindings.map((page) => page.title)).toEqual(expect.arrayContaining(['站点管理', '内容工作台', '访问统计', '数据看板']));
    expect(item?.pageBindings.length).toBeGreaterThan(1);
  });

  it('returns all operation page bindings without changing their operation classification', () => {
    const item = directory.items.find((entry) => entry.code === 'system:terminal:execute');

    expect(item?.surface).toBe('operation');
    expect(item?.pageBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Web 终端' }),
      expect.objectContaining({ title: '终端录屏' }),
    ]));
  });

  it('matches the published permission catalog contract', () => {
    expect(permissionCatalogSchema.safeParse(directory).success).toBe(true);
  });

  it('includes a custom page that binds a registered read permission', () => {
    const original = SEED_MENUS.find(page => page.permission === 'system:dict:list')!;
    const custom = { ...original, id: 100001, name: 'CustomDict', title: '测试字典页', path: '/custom-dict' };
    const entry = buildPermissionDirectory([...SEED_MENUS, custom]).items.find(item => item.code === original.permission);
    expect(entry?.pageBindings).toContainEqual({ id: 100001, title: '测试字典页', path: '/custom-dict' });
  });
});
