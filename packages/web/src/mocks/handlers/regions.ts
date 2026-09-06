import { buildRegionTree, filterRegionTree, regionContract, validateRegionLevelHierarchy, type Region } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockRegions, getNextRegionId } from '@/mocks/data/regions';
import { mockDateTime } from '@/mocks/utils/date';

// 行政层级约束与文案取自 shared，与服务端同源
function validateLevelHierarchy(level: Region['level'], parentCode: string | null | undefined): string | null {
  const parentLevel = parentCode ? (mockRegions.find((r) => r.code === parentCode)?.level ?? null) : null;
  return validateRegionLevelHierarchy(level, parentLevel);
}

export const regionsHandlers = [
  // 树形数据
  mock(regionContract.tree, ({ query, ok }) => {
    const keyword = query.keyword ?? '';
    const status = query.status ?? '';
    const level = query.level ?? '';
    const tree = buildRegionTree([...mockRegions]);
    const data = keyword || status || level ? filterRegionTree(tree, keyword, status, level) : tree;
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
