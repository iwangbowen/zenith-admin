import { regionContract, type Region } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockRegions, getNextRegionId, buildRegionTree } from '@/mocks/data/regions';
import { mockDateTime } from '@/mocks/utils/date';

// 与服务端一致的行政层级约束：province 仅根级、city 父须 province、county 父须 city
function validateLevelHierarchy(level: Region['level'], parentCode: string | null | undefined): string | null {
  const parentLevel = parentCode ? (mockRegions.find((r) => r.code === parentCode)?.level ?? null) : null;
  if (level === 'province') return parentLevel === null ? null : '省级地区不能挂载父级地区';
  if (level === 'city') return parentLevel === 'province' ? null : '市级地区的父级必须为省级地区';
  return parentLevel === 'city' ? null : '区县级地区的父级必须为市级地区';
}

function filterTree(nodes: Region[], keyword: string, status: string, level: string): Region[] {
  return nodes.reduce<Region[]>((acc, node) => {
    const children = node.children ? filterTree(node.children, keyword, status, level) : [];
    const keywordMatched = !keyword || node.name.includes(keyword) || node.code.includes(keyword);
    const statusMatched = !status || node.status === status;
    const levelMatched = !level || node.level === level;
    if ((keywordMatched && statusMatched && levelMatched) || children.length > 0) {
      acc.push({ ...node, children: children.length > 0 ? children : undefined });
    }
    return acc;
  }, []);
}

export const regionsHandlers = [
  // 树形数据
  mock(regionContract.tree, ({ query, ok }) => {
    const keyword = query.keyword ?? '';
    const status = query.status ?? '';
    const level = query.level ?? '';
    const tree = buildRegionTree([...mockRegions]);
    const data = keyword || status || level ? filterTree(tree, keyword, status, level) : tree;
    return ok(data);
  }),

  // 平铺列表
  mock(regionContract.flat, ({ ok }) => ok(mockRegions)),

  // 地区详情
  mock(regionContract.detail, ({ params, ok }) => {
    const region = mockRegions.find((r) => r.id === params.id);
    if (!region) return notFound('地区不存在', { status: 404 });
    return ok(region);
  }),

  // 创建
  mock(regionContract.create, ({ body, ok }) => {
    const levelError = validateLevelHierarchy(body.level, body.parentCode);
    if (levelError) return badRequest(levelError, { status: 400 });
    const now = mockDateTime();
    const newRegion: Region = {
      id: getNextRegionId(),
      code: body.code,
      name: body.name,
      level: body.level,
      parentCode: body.parentCode ?? null,
      sort: body.sort,
      status: body.status,
      createdAt: now,
      updatedAt: now,
    };
    mockRegions.push(newRegion);
    return ok(newRegion, '创建成功');
  }),

  // 更新
  mock(regionContract.update, ({ params, body, ok }) => {
    const region = mockRegions.find((r) => r.id === params.id);
    if (!region) {
      return notFound('地区不存在', { status: 404 });
    }
    const nextLevel = body.level ?? region.level;
    const nextParentCode = body.parentCode === undefined ? region.parentCode : body.parentCode;
    const levelError = validateLevelHierarchy(nextLevel, nextParentCode);
    if (levelError) return badRequest(levelError, { status: 400 });
    Object.assign(region, body, { updatedAt: mockDateTime() });
    return ok(region, '更新成功');
  }),

  // 删除
  mock(regionContract.remove, ({ params, ok }) => {
    const region = mockRegions.find((r) => r.id === params.id);
    if (!region) {
      return notFound('地区不存在', { status: 404 });
    }
    const hasChildren = mockRegions.some((r) => r.parentCode === region.code);
    if (hasChildren) {
      return badRequest('该地区下存在子地区，请先删除子地区', { status: 400 });
    }
    const idx = mockRegions.findIndex((r) => r.id === params.id);
    mockRegions.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
