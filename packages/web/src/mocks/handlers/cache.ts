import { http, HttpResponse } from 'msw';

interface MockCacheItem {
  key: string;
  displayKey: string;
  segment: string;
  category: string;
  type: string;
  ttl: number;
  size: number;
  value: string | null;
}

const mockCacheItems: MockCacheItem[] = [
  {
    key: 'zenith:session:550e8400-e29b-41d4-a716-446655440000',
    displayKey: 'session:550e8400-e29b-41d4-a716-446655440000',
    segment: 'session',
    category: '会话 Token',
    type: 'string',
    ttl: 28800,
    size: 210,
    value: '{"tokenId":"550e8400-e29b-41d4-a716-446655440000","userId":1,"username":"admin","nickname":"超级管理员","ip":"127.0.0.1"…',
  },
  {
    key: 'zenith:session:6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    displayKey: 'session:6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    segment: 'session',
    category: '会话 Token',
    type: 'string',
    ttl: 14400,
    size: 198,
    value: '{"tokenId":"6ba7b810-9dad-11d1-80b4-00c04fd430c8","userId":2,"username":"user01","nickname":"测试用户","ip":"192.168.1.1"…',
  },
  {
    key: 'zenith:blacklist:3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    displayKey: 'blacklist:3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    segment: 'blacklist',
    category: '强制下线黑名单',
    type: 'string',
    ttl: 3600,
    size: 1,
    value: '1',
  },
  {
    key: 'zenith:perm:1',
    displayKey: 'perm:1',
    segment: 'perm',
    category: '权限缓存',
    type: 'string',
    ttl: 600,
    size: 320,
    value: '["system:user:list","system:user:create","system:user:update","system:user:delete","system:role:list"…',
  },
  {
    key: 'zenith:perm:2',
    displayKey: 'perm:2',
    segment: 'perm',
    category: '权限缓存',
    type: 'string',
    ttl: 450,
    size: 48,
    value: '["dashboard:view"]',
  },
  {
    key: 'zenith:login_attempt:admin',
    displayKey: 'login_attempt:admin',
    segment: 'login_attempt',
    category: '登录失败计数',
    type: 'string',
    ttl: 180,
    size: 1,
    value: '2',
  },
];

export const cacheHandlers = [
  // 列出缓存 key
  http.get('/api/cache', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = [...mockCacheItems];
    if (keyword) {
      list = list.filter((item) => item.key.includes(keyword));
    }

    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total: list.length } });
  }),

  // 删除指定分类下的所有 key
  http.delete('/api/cache/by-category', async ({ request }) => {
    const body = await request.json() as { segment?: string };
    const segment = body?.segment;
    if (!segment) {
      return HttpResponse.json({ code: 400, message: '参数错误：缺少 segment', data: null }, { status: 400 });
    }
    let count = 0;
    for (let i = mockCacheItems.length - 1; i >= 0; i--) {
      if (mockCacheItems[i].segment === segment) {
        mockCacheItems.splice(i, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 条缓存`, data: { count } });
  }),

  // 删除单个 key
  http.delete('/api/cache', async ({ request }) => {
    const body = await request.json() as { key?: string };
    const key = body?.key;
    if (!key) {
      return HttpResponse.json({ code: 400, message: '参数错误：缺少 key', data: null }, { status: 400 });
    }
    const index = mockCacheItems.findIndex((item) => item.key === key);
    if (index === -1) {
      return HttpResponse.json({ code: 404, message: 'key 不存在', data: null }, { status: 404 });
    }
    mockCacheItems.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 清空所有缓存
  http.delete('/api/cache/all', () => {
    const count = mockCacheItems.length;
    mockCacheItems.splice(0, mockCacheItems.length);
    return HttpResponse.json({ code: 0, message: `已清空 ${count} 条缓存`, data: { count } });
  }),
];
