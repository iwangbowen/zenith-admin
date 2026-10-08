import { describe, expect, it } from 'vitest';
import { isLicenseFeatureKey } from '../licensing/constants';
import { CORE_MENU_ROOTS } from '../licensing/feature-catalog';
import { collectMenuSubtreeIds, SEED_MENUS } from './menus';

describe('真实菜单的功能归类', () => {
  it.each([['growth', 17000], ['iot', 18000]] as const)('%s 的全部页面与按钮继承功能授权', (feature, rootId) => {
    const subtree = new Set(collectMenuSubtreeIds(rootId));
    const menus = SEED_MENUS.filter((menu) => subtree.has(menu.id));
    expect(menus.some((menu) => menu.type === 'button')).toBe(true);
    expect(menus.every((menu) => menu.featureKey === feature)).toBe(true);
  });

  it('已有核心入口保留，系统设置内的运维与机器人仍单独授权', () => {
    for (const { id, reason } of CORE_MENU_ROOTS) {
      expect(reason.trim()).not.toBe('');
      expect(SEED_MENUS.find((menu) => menu.id === id)?.featureKey, String(id)).toBeNull();
    }
    expect(SEED_MENUS.find((menu) => menu.id === 2380)?.featureKey).toBe('chat');
    expect(SEED_MENUS.find((menu) => menu.id === 2440)?.featureKey).toBe('ops');
    expect(SEED_MENUS.every((menu) => menu.featureKey === null || isLicenseFeatureKey(menu.featureKey!))).toBe(true);
  });
});
