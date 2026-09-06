import { apiScopeContract } from '@zenith/shared/open-platform';
import type { ApiScope } from '@zenith/shared/open-platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockApiScopes } from '@/mocks/data/api-scopes';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { removeByIds } from '@/mocks/utils/crud';

const scopes: ApiScope[] = mockApiScopes.map((s) => ({ ...s }));
let nextId = nextIdFrom(scopes);

export const apiScopesHandlers = [
  mock(apiScopeContract.options, ({ ok }) => ok(scopes.filter((s) => s.status === 'enabled'))),

  mock(apiScopeContract.list, ({ query, ok, paginate }) => {
    let filtered = scopes;
    if (query.keyword) filtered = filterByKeyword(filtered, query.keyword, [(s) => s.code, (s) => s.name]);
    if (query.scopeGroup) filtered = filtered.filter((s) => s.scopeGroup === query.scopeGroup);
    if (query.status) filtered = filtered.filter((s) => s.status === query.status);
    return ok(paginate(filtered));
  }),

  mock(apiScopeContract.create, ({ body, ok }) => {
    if (scopes.some((s) => s.code === body.code)) {
      return badRequest('scope 编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const created: ApiScope = {
      id: nextId++,
      code: body.code,
      name: body.name,
      description: body.description ?? null,
      scopeGroup: body.scopeGroup,
      status: body.status,
      usedByAppCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    scopes.unshift(created);
    return ok(created, '创建成功');
  }),

  mock(apiScopeContract.removeBatch, ({ body, ok }) => {
    const deleted = removeByIds(scopes, body.ids);
    return ok(null, `已删除 ${deleted} 条记录`);
  }),

  mock(apiScopeContract.detail, ({ params, ok }) => {
    const found = scopes.find((s) => s.id === params.id);
    return found ? ok(found) : notFound('API Scope 不存在', { status: 404 });
  }),

  mock(apiScopeContract.update, ({ params, body, ok }) => {
    const idx = scopes.findIndex((s) => s.id === params.id);
    if (idx === -1) return notFound('API Scope 不存在', { status: 404 });
    scopes[idx] = { ...scopes[idx], ...body, updatedAt: mockDateTime() };
    return ok(scopes[idx], '更新成功');
  }),

  mock(apiScopeContract.remove, ({ params, ok }) => {
    const idx = scopes.findIndex((s) => s.id === params.id);
    if (idx === -1) return notFound('API Scope 不存在', { status: 404 });
    scopes.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
