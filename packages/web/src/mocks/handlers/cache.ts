import { http, HttpResponse } from 'msw';
import { mockDate } from '../utils/date';

interface MockCacheItem {
  key: string;
  displayKey: string;
  segment: string;
  category: string;
  type: string;
  ttl: number;
  size: number;
  value: string | null;
  /** 非 string 类型的完整值（序列化 JSON），对应 /api/cache/value */
  fullValue?: string;
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
  {
    key: 'zenith:rl:172.16.0.10',
    displayKey: 'rl:172.16.0.10',
    segment: 'rl',
    category: '接口限流计数',
    type: 'string',
    ttl: 45,
    size: 1,
    value: '3',
  },
  {
    key: 'zenith:rlstats:ai_chat_send:hit',
    displayKey: 'rlstats:ai_chat_send:hit',
    segment: 'rlstats',
    category: '限流统计',
    type: 'string',
    ttl: 86400,
    size: 1,
    value: '5',
  },
  {
    key: `zenith:ai:req:${mockDate()}`,
    displayKey: `ai:req:${mockDate()}`,
    segment: 'ai',
    category: 'AI 服务',
    type: 'string',
    ttl: 3600 * 24 * 30,
    size: 2,
    value: '12',
  },
  {
    key: 'zenith:openrl:monthly:demo-app:api_call',
    displayKey: 'openrl:monthly:demo-app:api_call',
    segment: 'openrl',
    category: '开放平台限流',
    type: 'string',
    ttl: 3600 * 24 * 10,
    size: 2,
    value: '42',
  },
  {
    key: `zenith:report:quota:1:${mockDate()}`,
    displayKey: `report:quota:1:${mockDate()}`,
    segment: 'report',
    category: '报表中心',
    type: 'hash',
    ttl: 3600 * 16,
    size: 5,
    value: null,
    fullValue: '{"scan_rows":"152400","result_rows":"3200","query_count":"18","exceeded":"0","updated_at":"1752885000"}',
  },
  {
    key: 'zenith:member-session:9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8',
    displayKey: 'member-session:9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8',
    segment: 'member-session',
    category: '会员会话',
    type: 'string',
    ttl: 25200,
    size: 186,
    value: '{"memberId":1,"nickname":"演示会员","loginType":"phone_password"}',
  },
  {
    key: 'zenith:mp:access_token:wx1234567890abcdef',
    displayKey: 'mp:access_token:wx1234567890abcdef',
    segment: 'mp',
    category: '公众号凭证',
    type: 'string',
    ttl: 6800,
    size: 110,
    value: '88_demo_access_token…',
  },
];

export const cacheHandlers = [
  // Redis 概览统计
  http.get('/api/cache/overview', () => {
    const totalKeys = mockCacheItems.length;
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: {
        connected: true,
        version: '7.2.4',
        uptimeSeconds: 86_400 * 3 + 3600 * 5,
        connectedClients: 4,
        usedMemory: 2_345_678,
        usedMemoryHuman: '2.24M',
        maxMemory: 0,
        memFragmentationRatio: 1.18,
        keyspaceHits: 152_340,
        keyspaceMisses: 4_210,
        hitRate: 97.31,
        totalKeys,
        keyPrefix: 'zenith:',
      },
    });
  }),

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

  // 获取指定 key 的完整值（string 返回原值，其他类型返回序列化 JSON）
  http.get('/api/cache/value', ({ request }) => {
    const url = new URL(request.url);
    const key = url.searchParams.get('key') ?? '';
    const item = mockCacheItems.find((i) => i.key === key);
    if (!item) return HttpResponse.json({ code: 0, message: 'ok', data: null });
    const data = item.type === 'string' ? (item.value ?? null) : (item.fullValue ?? null);
    return HttpResponse.json({ code: 0, message: 'ok', data });
  }),

  // 修改指定 key 的 TTL
  http.put('/api/cache/ttl', async ({ request }) => {
    const body = await request.json() as { key?: string; ttl?: number };
    const item = mockCacheItems.find((i) => i.key === body?.key);
    if (!item) {
      return HttpResponse.json({ code: 404, message: 'key 不存在', data: null }, { status: 404 });
    }
    if (body.ttl === undefined || (body.ttl !== -1 && body.ttl <= 0)) {
      return HttpResponse.json({ code: 400, message: 'TTL 必须为 -1（永久）或大于 0 的秒数', data: null }, { status: 400 });
    }
    item.ttl = body.ttl;
    return HttpResponse.json({ code: 0, message: '修改成功', data: null });
  }),

  // 修改指定 key 的值（仅字符串）
  http.put('/api/cache/value', async ({ request }) => {
    const body = await request.json() as { key?: string; value?: string; ttl?: number };
    const item = mockCacheItems.find((i) => i.key === body?.key);
    if (!item) {
      return HttpResponse.json({ code: 404, message: 'key 不存在', data: null }, { status: 404 });
    }
    if (item.type !== 'string') {
      return HttpResponse.json({ code: 400, message: '仅支持编辑字符串类型的缓存', data: null }, { status: 400 });
    }
    item.value = body.value ?? '';
    item.size = new TextEncoder().encode(item.value).length;
    if (body.ttl !== undefined) item.ttl = body.ttl;
    return HttpResponse.json({ code: 0, message: '修改成功', data: null });
  }),

  // 批量删除 key
  http.delete('/api/cache/batch', async ({ request }) => {
    const body = await request.json() as { keys?: string[] };
    const keys = body?.keys;
    if (!Array.isArray(keys) || keys.length === 0) {
      return HttpResponse.json({ code: 400, message: '参数错误：缺少 keys', data: null }, { status: 400 });
    }
    let count = 0;
    for (const key of keys) {
      const index = mockCacheItems.findIndex((item) => item.key === key);
      if (index !== -1) {
        mockCacheItems.splice(index, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 条缓存`, data: { count } });
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
