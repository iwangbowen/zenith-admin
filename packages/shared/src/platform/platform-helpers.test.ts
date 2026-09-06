/**
 * 平台域共享纯逻辑单测：行政区划树 / 层级约束 / 过滤，脱敏字段筛选谓词，监控分桶配置完整性。
 */
import { describe, expect, it } from 'vitest';
import { MONITOR_HISTORY_RANGES, MONITOR_HISTORY_RANGE_CONFIG } from './constants';
import type { Region } from './contracts/regions';
import { matchesDataMaskFieldQuery } from './data-mask';
import { buildRegionTree, filterRegionTree, validateRegionLevelHierarchy } from './regions';

const region = (code: string, name: string, level: Region['level'], parentCode: string | null, sort = 0, status: Region['status'] = 'enabled'): Omit<Region, 'children'> => ({
  id: Number(code), code, name, level, parentCode, sort, status, createdAt: '2026-01-01 00:00:00', updatedAt: '2026-01-01 00:00:00',
});

const flat = [
  region('11', '北京市', 'province', null, 1),
  region('1101', '市辖区', 'city', '11', 1),
  region('110101', '东城区', 'county', '1101', 2),
  region('110102', '西城区', 'county', '1101', 1, 'disabled'),
  region('44', '广东省', 'province', null, 2),
  region('4401', '广州市', 'city', '44', 1),
  region('9999', '孤儿节点', 'city', '404', 9),
];

describe('buildRegionTree', () => {
  it('按 parentCode 挂接、逐层按 sort/code 排序、父级缺失提升为根、叶子不带 children', () => {
    const tree = buildRegionTree(flat);
    expect(tree.map((n) => n.code)).toEqual(['11', '44', '9999']);
    const bj = tree[0];
    expect(bj.children?.map((n) => n.code)).toEqual(['1101']);
    expect(bj.children?.[0].children?.map((n) => n.code)).toEqual(['110102', '110101']);
    expect(bj.children?.[0].children?.[0].children).toBeUndefined();
  });
});

describe('filterRegionTree', () => {
  const tree = buildRegionTree(flat);

  it('关键词匹配名称或代码，子级命中时保留祖先链', () => {
    const out = filterRegionTree(tree, '东城');
    expect(out.map((n) => n.code)).toEqual(['11']);
    expect(out[0].children?.[0].children?.map((n) => n.code)).toEqual(['110101']);
  });

  it('状态 / 层级精确匹配；无命中子级的节点不带 children', () => {
    const byStatus = filterRegionTree(tree, '', 'disabled');
    expect(byStatus[0].children?.[0].children?.map((n) => n.code)).toEqual(['110102']);
    const byLevel = filterRegionTree(tree, '', undefined, 'province');
    expect(byLevel.map((n) => n.code)).toEqual(['11', '44']);
    expect(byLevel[0].children).toBeUndefined();
  });
});

describe('validateRegionLevelHierarchy', () => {
  it('省级只能为根，市挂省，区县挂市', () => {
    expect(validateRegionLevelHierarchy('province', null)).toBeNull();
    expect(validateRegionLevelHierarchy('province', 'province')).toBe('省级地区不能挂载父级地区');
    expect(validateRegionLevelHierarchy('city', 'province')).toBeNull();
    expect(validateRegionLevelHierarchy('city', null)).toBe('市级地区的父级必须为省级地区');
    expect(validateRegionLevelHierarchy('county', 'city')).toBeNull();
    expect(validateRegionLevelHierarchy('county', 'province')).toBe('区县级地区的父级必须为市级地区');
  });
});

describe('matchesDataMaskFieldQuery', () => {
  const item = { entity: 'User', field: 'phone', label: '手机号', key: 'User.phone', maskType: 'phone', enabled: true, overridden: false };

  it('关键词大小写无关地匹配实体 / 字段 / 标签 / 键', () => {
    expect(matchesDataMaskFieldQuery(item, { keyword: ' user ' })).toBe(true);
    expect(matchesDataMaskFieldQuery(item, { keyword: 'PHONE' })).toBe(true);
    expect(matchesDataMaskFieldQuery(item, { keyword: '手机' })).toBe(true);
    expect(matchesDataMaskFieldQuery(item, { keyword: 'email' })).toBe(false);
  });

  it('其余条件精确匹配，未传条件不参与筛选', () => {
    expect(matchesDataMaskFieldQuery(item, {})).toBe(true);
    expect(matchesDataMaskFieldQuery(item, { entity: 'Member' })).toBe(false);
    expect(matchesDataMaskFieldQuery(item, { maskType: 'phone', enabled: true, overridden: false })).toBe(true);
    expect(matchesDataMaskFieldQuery(item, { overridden: true })).toBe(false);
    expect(matchesDataMaskFieldQuery(item, { enabled: false })).toBe(false);
  });
});

describe('MONITOR_HISTORY_RANGE_CONFIG', () => {
  it('每个时间范围都有分桶配置且窗口能被桶宽整除', () => {
    for (const range of MONITOR_HISTORY_RANGES) {
      const cfg = MONITOR_HISTORY_RANGE_CONFIG[range];
      expect(cfg.windowSec).toBeGreaterThan(cfg.bucketSec);
      expect(cfg.windowSec % cfg.bucketSec).toBe(0);
    }
  });
});
