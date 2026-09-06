import { buildTree } from '../core/tree';
import type { RegionLevel } from './constants';
import type { Region } from './contracts/regions';

/** 行政层级约束：province 仅根级、city 父须 province、county 父须 city */
export const REGION_LEVEL_PARENT: Record<RegionLevel, RegionLevel | null> = {
  province: null,
  city: 'province',
  county: 'city',
};

export const REGION_LEVEL_SHORT_LABELS: Record<RegionLevel, string> = {
  province: '省',
  city: '市',
  county: '区县',
};

/**
 * 校验「层级 + 父级层级」组合是否符合行政层级约束；合法返回 null，否则返回给用户看的错误文案。
 * 服务端（抛 400）与 Mock 共用同一份规则与文案。
 */
export function validateRegionLevelHierarchy(level: RegionLevel, parentLevel: string | null): string | null {
  const expected = REGION_LEVEL_PARENT[level];
  if (expected === null) return parentLevel === null ? null : '省级地区不能挂载父级地区';
  return parentLevel === expected
    ? null
    : `${REGION_LEVEL_SHORT_LABELS[level]}级地区的父级必须为${REGION_LEVEL_SHORT_LABELS[expected]}级地区`;
}

/** 平铺行政区划 → 按 parentCode 挂接的树（逐层按 sort、code 排序；父级缺失的节点提升为根） */
export function buildRegionTree(list: readonly Omit<Region, 'children'>[]): Region[] {
  return buildTree<Region>(list as readonly Region[], {
    id: (r) => r.code,
    parentId: (r) => r.parentCode || null,
    compare: (a, b) => a.sort - b.sort || a.code.localeCompare(b.code),
  });
}

/** 按关键词（名称 / 代码）、状态、层级过滤树；子节点命中时保留其祖先链 */
export function filterRegionTree(nodes: readonly Region[], keyword: string, status?: string, level?: string): Region[] {
  return nodes.reduce<Region[]>((acc, node) => {
    const children = node.children ? filterRegionTree(node.children, keyword, status, level) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    const levelMatched = !level || node.level === level;
    if ((keywordMatched && statusMatched && levelMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}
