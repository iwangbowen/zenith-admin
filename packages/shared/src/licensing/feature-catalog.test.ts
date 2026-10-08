import { describe, expect, it } from 'vitest';
import { LICENSE_FEATURE_OPTIONS, LICENSE_FEATURES } from './constants';
import { applyMenuFeatureKeys, LICENSE_EDITION_PRESETS, LICENSE_FEATURE_CATALOG } from './feature-catalog';

describe('License 功能目录', () => {
  it('运营与 IoT 进入授权选项，预设按版本分配', () => {
    expect(LICENSE_FEATURE_OPTIONS).toEqual(expect.arrayContaining([
      { value: 'growth', label: '运营中心' },
      { value: 'iot', label: 'IoT 设备' },
    ]));
    expect(LICENSE_EDITION_PRESETS.pro).toContain('growth');
    expect(LICENSE_EDITION_PRESETS.pro).not.toContain('iot');
    expect(LICENSE_EDITION_PRESETS.community).not.toContain('growth');
    expect(LICENSE_EDITION_PRESETS.community).not.toContain('iot');
    expect(LICENSE_EDITION_PRESETS.enterprise).toEqual(LICENSE_FEATURES);
    expect(Object.keys(LICENSE_FEATURE_CATALOG).sort()).toEqual([...LICENSE_FEATURES].sort());
  });

});

describe('菜单功能归类防漏', () => {
  const menus = [
    { id: 1, parentId: 0 },
    { id: 2, parentId: 1 },
    { id: 10, parentId: 0 },
    { id: 11, parentId: 10 },
    { id: 12, parentId: 11 },
  ];
  const catalog = { growth: { menuRoots: [10] } };
  const coreRoots = [{ id: 1, reason: '基础入口' }];

  it('新子菜单继承已归类父级，授权子树可位于核心容器', () => {
    const result = applyMenuFeatureKeys([
      ...menus,
      { id: 3, parentId: 2 },
      { id: 13, parentId: 12 },
      { id: 20, parentId: 2 },
      { id: 21, parentId: 20 },
    ], { ...catalog, iot: { menuRoots: [20] } }, coreRoots);
    expect(result.find((menu) => menu.id === 3)?.featureKey).toBeNull();
    expect(result.find((menu) => menu.id === 13)?.featureKey).toBe('growth');
    expect(result.find((menu) => menu.id === 21)?.featureKey).toBe('iot');
  });

  it('新增顶层模块必须登记，不能静默变为核心能力', () => {
    expect(() => applyMenuFeatureKeys([...menus, { id: 100, parentId: 0 }], catalog, coreRoots))
      .toThrow(/顶层菜单 100 未归类/);
  });

  it('拒绝不存在的授权菜单根', () => {
    expect(() => applyMenuFeatureKeys(menus, { growth: { menuRoots: [99] } }, coreRoots))
      .toThrow(/授权菜单根 99 不存在/);
  });

  it('拒绝同一功能或不同功能重复登记一个授权根', () => {
    expect(() => applyMenuFeatureKeys(menus, { growth: { menuRoots: [10, 10] } }, coreRoots))
      .toThrow(/授权菜单根 10 重复登记/);
    expect(() => applyMenuFeatureKeys(menus, { ...catalog, iot: { menuRoots: [10] } }, coreRoots))
      .toThrow(/授权菜单根 10 重复登记/);
  });

  it('拒绝授权根互相嵌套，即使属于同一功能', () => {
    expect(() => applyMenuFeatureKeys(menus, { growth: { menuRoots: [10, 11] } }, coreRoots))
      .toThrow(/授权菜单根 11 与 10 重叠/);
    expect(() => applyMenuFeatureKeys(menus, { ...catalog, iot: { menuRoots: [11] } }, coreRoots))
      .toThrow(/授权菜单根 11 与 10 重叠/);
  });

  it('核心归类必须存在、唯一、位于顶层且有原因', () => {
    expect(() => applyMenuFeatureKeys(menus, catalog, [...coreRoots, coreRoots[0]!])).toThrow(/重复归类/);
    expect(() => applyMenuFeatureKeys(menus, catalog, [...coreRoots, { id: 10, reason: '重复' }])).toThrow(/重复归类/);
    expect(() => applyMenuFeatureKeys(menus, catalog, [{ id: 99, reason: '无此菜单' }])).toThrow(/核心菜单根 99 不存在/);
    expect(() => applyMenuFeatureKeys(menus, catalog, [{ id: 2, reason: '非顶层' }])).toThrow(/必须是顶层入口/);
    expect(() => applyMenuFeatureKeys(menus, catalog, [{ id: 1, reason: ' ' }])).toThrow(/缺少归类原因/);
  });

  it('孤立节点、无根循环与重复菜单 ID 都不能绕过覆盖检查', () => {
    expect(() => applyMenuFeatureKeys([...menus, { id: 50, parentId: 99 }], catalog, coreRoots)).toThrow(/未覆盖.*父节点 99 不存在/);
    expect(() => applyMenuFeatureKeys([...menus, { id: 50, parentId: 51 }, { id: 51, parentId: 50 }], catalog, coreRoots)).toThrow(/菜单 50 未覆盖/);
    expect(() => applyMenuFeatureKeys([...menus, menus[0]!], catalog, coreRoots)).toThrow(/菜单 ID 1 重复/);
  });
});
