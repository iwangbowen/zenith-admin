import { http, HttpResponse } from 'msw';
import { mockRegions, getNextRegionId, buildRegionTree } from '@/mocks/data/regions';
import { mockDateTime } from '@/mocks/utils/date';
import type { Region } from '@zenith/shared';

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
  // GET / — 树形数据
  http.get('/api/regions', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const level = url.searchParams.get('level') ?? '';

    const tree = buildRegionTree([...mockRegions]);
    const data = keyword || status || level ? filterTree(tree, keyword, status, level) : tree;
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // GET /flat — 平铺列表
  http.get('/api/regions/flat', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: mockRegions });
  }),

  // GET /:id — 地区详情
  http.get('/api/regions/:id', ({ params }) => {
    const region = mockRegions.find((r) => r.id === Number(params.id));
    if (!region) return HttpResponse.json({ code: 404, message: '地区不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: region });
  }),

  // POST / — 创建
  http.post('/api/regions', async ({ request }) => {
    const body = (await request.json()) as Partial<Region>;
    const levelError = validateLevelHierarchy(body.level ?? 'province', body.parentCode);
    if (levelError) return HttpResponse.json({ code: 400, message: levelError, data: null }, { status: 400 });
    const now = mockDateTime();
    const newRegion: Region = {
      id: getNextRegionId(),
      code: body.code ?? '',
      name: body.name ?? '',
      level: body.level ?? 'province',
      parentCode: body.parentCode ?? null,
      sort: body.sort ?? 0,
      status: body.status ?? 'enabled',
      createdAt: now,
      updatedAt: now,
    };
    mockRegions.push(newRegion);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newRegion });
  }),

  // PUT /:id — 更新
  http.put('/api/regions/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const region = mockRegions.find((r) => r.id === id);
    if (!region) {
      return HttpResponse.json({ code: 404, message: '地区不存在', data: null }, { status: 404 });
    }
    const body = (await request.json()) as Partial<Region>;
    const nextLevel = body.level ?? region.level;
    const nextParentCode = body.parentCode === undefined ? region.parentCode : body.parentCode;
    const levelError = validateLevelHierarchy(nextLevel, nextParentCode);
    if (levelError) return HttpResponse.json({ code: 400, message: levelError, data: null }, { status: 400 });
    Object.assign(region, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: region });
  }),

  // DELETE /:id — 删除
  http.delete('/api/regions/:id', ({ params }) => {
    const id = Number(params.id);
    const region = mockRegions.find((r) => r.id === id);
    if (!region) {
      return HttpResponse.json({ code: 404, message: '地区不存在', data: null }, { status: 404 });
    }
    const hasChildren = mockRegions.some((r) => r.parentCode === region.code);
    if (hasChildren) {
      return HttpResponse.json({ code: 400, message: '该地区下存在子地区，请先删除子地区', data: null }, { status: 400 });
    }
    const idx = mockRegions.findIndex((r) => r.id === id);
    mockRegions.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
