import { apiTokenContract, type UserApiToken, type UserApiTokenCreated } from '@zenith/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

type TokenEntry = UserApiToken & { _full: string };

const mockTokenStore: TokenEntry[] = [
  {
    id: 1,
    name: '本地开发环境',
    tokenPrefix: 'zat_localdev01...',
    _full: 'zat_localdev0137f82c9b4e5a',
    lastUsedAt: mockDateTimeOffset(-3600 * 1000),
    expiresAt: null,
    createdAt: '2024-03-01 00:00:00',
  },
  {
    id: 2,
    name: 'CI/CD Pipeline',
    tokenPrefix: 'zat_cicd00x002...',
    _full: 'zat_cicd00x002a9b7fe3c81d',
    lastUsedAt: mockDateTimeOffset(-2 * 86400 * 1000),
    expiresAt: mockDateTimeOffset(90 * 86400 * 1000),
    createdAt: '2024-04-15 08:00:00',
  },
];

export const apiTokensHandlers = [
  // 获取 Token 列表（隐藏完整 token）
  mock(apiTokenContract.list, ({ ok }) => {
    const data: UserApiToken[] = mockTokenStore.map(({ _full: _, ...t }) => t);
    return ok(data);
  }),

  // 创建 Token（仅在此刻返回完整值）
  mock(apiTokenContract.create, ({ body, ok }) => {
    if (!body.name.trim()) {
      return badRequest('Token 名称不能为空', { status: 400 });
    }
    if (mockTokenStore.length >= 20) {
      return badRequest('最多只能创建 20 个 API Token', { status: 400 });
    }
    const token = `zat_demo${Math.random().toString(36).slice(2).padEnd(20, '0').slice(0, 20)}`;
    const entry: TokenEntry = {
      id: nextIdFrom(mockTokenStore),
      name: body.name.trim(),
      tokenPrefix: `${token.slice(0, 12)}...`,
      _full: token,
      lastUsedAt: null,
      expiresAt: body.expiresAt ?? null,
      createdAt: mockDateTime(),
    };
    mockTokenStore.push(entry);
    const response: UserApiTokenCreated = {
      id: entry.id,
      name: entry.name,
      token,
      createdAt: entry.createdAt,
    };
    return ok(response, 'Token 已创建，请务必复制保存，此后将无法再次查看完整 Token');
  }),

  // 撤销 Token
  mock(apiTokenContract.remove, ({ params, ok }) => {
    requireItem(mockTokenStore, params.id, 'Token 不存在', { status: 404 });
    removeByIds(mockTokenStore, [params.id]);
    return ok(null, 'Token 已撤销');
  }),
];
