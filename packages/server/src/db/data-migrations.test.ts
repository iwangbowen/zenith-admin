import { describe, expect, it } from 'vitest';
import type { DbTransaction } from './types';
import { menus, roleMenus, roles } from './schema';
import { applyCmsStage3MenuData } from './data-migrations';

describe('CMS Stage3 production menu data migration', () => {
  it('upserts renamed permissions, inserts Stage3 menus, and binds roles idempotently', async () => {
    const menuState = new Map<number, Record<string, unknown>>([
      [1745, { id: 1745, permission: 'cms:static:build', title: '旧静态化' }],
    ]);
    const bindingState = new Set<string>();
    const fake = {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => table === roles ? [{ id: 1 }, { id: 3 }] : [],
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
});
