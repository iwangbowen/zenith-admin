import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { SEED_MENUS } from '@zenith/shared';
import type { DbTransaction } from './types';
import { menus, roleMenus, roles } from './schema';
import {
  applyCmsStage3MenuData,
  remapCmsMenuBindingRows,
} from './data-migrations';

describe('CMS Stage3 production menu data migration', () => {
  it('upserts renamed permissions, inserts Stage3 menus, and binds roles idempotently', async () => {
    const menuState = new Map<number, Record<string, unknown>>([
      [1745, { id: 1745, permission: 'cms:static:build', title: '旧静态化' }],
    ]);
    const bindingState = new Set<string>();
    const fake = {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => table === roles ? [{ id: 1, code: 'super_admin' }, { id: 3, code: 'cms_editor' }] : [],
        }),
      }),
      insert: (table: unknown) => ({
        values: (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
          const rows = Array.isArray(input) ? input : [input];
          return {
            onConflictDoUpdate: async () => {
              if (table === menus) for (const row of rows) menuState.set(Number(row.id), { ...menuState.get(Number(row.id)), ...row });
            },
            onConflictDoNothing: async () => {
              if (table === roleMenus) {
                for (const row of rows) bindingState.add(`${row.roleId}:${row.menuId}`);
              }
            },
          };
        },
      }),
    } as unknown as DbTransaction;

    await applyCmsStage3MenuData(fake);
    await applyCmsStage3MenuData(fake);

    expect(menuState.get(1745)?.permission).toBe('cms:publish:build');
    expect(menuState.get(1800)?.path).toBe('/cms/themes');
    expect(menuState.get(1810)?.path).toBe('/cms/publishing');
    expect(bindingState.has('1:1810')).toBe(true);
    expect(bindingState.has('3:1810')).toBe(true);
    expect(bindingState.size).toBeGreaterThan(0);
  });

  describe('CMS Stage4 production data migration', () => {
    it('removes legacy poll menus and provisions new permissions plus retention config without full seed', async () => {
      const source = await readFile(new URL('./data-migrations.ts', import.meta.url), 'utf8');
      expect(source).toContain('2026-07-cms-stage4-menus-v2');
      expect(source).toContain('[1751, 1792]');
      expect(source).toContain('[1752, 1793]');
      expect(source).toContain('legacyUsers');
      expect(source).toContain('legacyPackages');
      expect(source).toContain('cms_ad_event_retention_days');
      expect(SEED_MENUS.some((menu) => menu.permission === 'cms:interaction:list')).toBe(true);
      expect(SEED_MENUS.some((menu) => menu.permission === 'cms:subscription:list')).toBe(true);
      expect(SEED_MENUS.some((menu) => menu.permission === 'cms:page:acl')).toBe(true);
      expect(SEED_MENUS.some((menu) => menu.permission === 'cms:interaction:export-raw')).toBe(true);
      expect(SEED_MENUS.some((menu) => menu.permission === 'cms:ad-event:export-raw')).toBe(true);
    });

    it('preserves each legacy custom binding owner while mapping list/manage separately', () => {
      expect(remapCmsMenuBindingRows([
        { roleId: 7, menuId: 1751 },
        { roleId: 8, menuId: 1752 },
      ], 'roleId')).toEqual([
        { roleId: 7, menuId: 1792 },
        { roleId: 8, menuId: 1793 },
      ]);
      expect(remapCmsMenuBindingRows([{ userId: 3, menuId: 1752 }], 'userId'))
        .toEqual([{ userId: 3, menuId: 1793 }]);
      expect(remapCmsMenuBindingRows([{ packageId: 4, menuId: 1751 }], 'packageId'))
        .toEqual([{ packageId: 4, menuId: 1792 }]);
    });
  });
});
