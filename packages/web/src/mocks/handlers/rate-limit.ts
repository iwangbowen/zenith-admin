import { http, HttpResponse } from 'msw';
import { mockDateTime, mockDateTimeOffset } from '../utils/date';

interface MockRule {
  id: number;
  name: string;
  description: string | null;
  windowMs: number;
  limit: number;
  keyType: 'ip' | 'user' | 'ip_path';
  enabled: boolean;
  blockedMessage: string | null;
  pathPatterns: string[];
  createdAt: string;
  updatedAt: string;
}

const rules: MockRule[] = [
  { id: 1, name: 'auth',      description: '登录接口限流',          windowMs: 3 * 60 * 1000,     limit: 20, keyType: 'ip', enabled: false,  blockedMessage: '登录尝试过于频繁，请 3 分钟后再试',  pathPatterns: [],  createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 2, name: 'captcha',   description: '验证码接口限流',        windowMs: 60 * 1000,         limit: 30, keyType: 'ip', enabled: true,  blockedMessage: '验证码请求过于频繁，请稍后再试',     pathPatterns: [],  createdAt: mockDateTime(), updatedAt: mockDateTime() },
  { id: 3, name: 'sensitive', description: '敏感操作（注册/重置）限流', windowMs: 60 * 60 * 1000, limit: 5,  keyType: 'ip', enabled: false, blockedMessage: '操作过于频繁，请 1 小时后重试',     pathPatterns: [],  createdAt: mockDateTime(), updatedAt: mockDateTime() },
];

const stats = {
  auth:      { hit: 8421, blocked: 12, recent: [
    { at: mockDateTimeOffset(-5 * 60 * 1000),  key: '203.0.113.42',  path: '/api/auth/login' },
    { at: mockDateTimeOffset(-22 * 60 * 1000), key: '198.51.100.7',  path: '/api/auth/login' },
  ] },
  captcha:   { hit: 12034, blocked: 3, recent: [
    { at: mockDateTimeOffset(-1 * 60 * 60 * 1000), key: '192.0.2.55', path: '/api/auth/captcha' },
  ] },
  sensitive: { hit: 187, blocked: 0, recent: [] as { at: string; key: string; path: string }[] },
};

export const rateLimitHandlers = [
  http.get('/api/rate-limit/rules', () =>
    HttpResponse.json({ code: 0, message: 'success', data: rules }),
  ),

  http.patch('/api/rate-limit/rules/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const patch = await request.json() as Partial<MockRule>;
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '规则不存在', data: null }, { status: 404 });
    rules[idx] = { ...rules[idx], ...patch, updatedAt: mockDateTime() };
    return HttpResponse.json({ code: 0, message: '规则已更新', data: rules[idx] });
  }),

  http.post('/api/rate-limit/rules', async ({ request }) => {
    const body = await request.json() as Omit<MockRule, 'id' | 'createdAt' | 'updatedAt'>;
    const existing = rules.find((r) => r.name === body.name);
    if (existing) return HttpResponse.json({ code: 400, message: `规则名称 "${body.name}" 已存在`, data: null }, { status: 400 });
    const newRule: MockRule = { ...body, id: rules.length + 1, createdAt: mockDateTime(), updatedAt: mockDateTime() };
    rules.push(newRule);
    return HttpResponse.json({ code: 0, message: '规则已创建', data: newRule });
  }),

  http.delete('/api/rate-limit/rules/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '规则不存在', data: null }, { status: 404 });
    if (['auth', 'captcha', 'sensitive'].includes(rules[idx].name)) {
      return HttpResponse.json({ code: 400, message: '内置规则不可删除', data: null }, { status: 400 });
    }
    rules.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '规则已删除', data: null });
  }),

  http.get('/api/rate-limit/stats', () => {
    const items = rules.map((r) => {
      const s = stats[r.name as keyof typeof stats] ?? { hit: 0, blocked: 0, recent: [] };
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const hourlySeries = Array.from({ length: 24 }, (_, i) => {
        const t = new Date(now.getTime() - (23 - i) * 3600 * 1000);
        const mm = String(t.getMonth() + 1).padStart(2, '0');
        const dd = String(t.getDate()).padStart(2, '0');
        const hh = String(t.getHours()).padStart(2, '0');
        return {
          hour: `${mm}-${dd} ${hh}:00`,
          hits: r.enabled ? Math.floor(Math.random() * 600) + 50 : 0,
          blocked: r.enabled ? Math.floor(Math.random() * 5) : 0,
        };
      });
      return {
        name: r.name,
        description: r.description,
        windowMs: r.windowMs,
        limit: r.limit,
        keyType: r.keyType,
        enabled: r.enabled,
        hitCount: s.hit,
        blockedCount: s.blocked,
        blockRate: s.hit > 0 ? Math.round((s.blocked / s.hit) * 10000) / 100 : 0,
        recentBlocks: s.recent,
        hourlySeries,
      };
    });
    return HttpResponse.json({ code: 0, message: 'success', data: { items } });
  }),

  http.post('/api/rate-limit/unblock', async ({ request }) => {
    const { name, key } = await request.json() as { name: string; key: string };
    const bucket = stats[name as keyof typeof stats];
    if (bucket) bucket.recent = bucket.recent.filter((b) => b.key !== key);
    return HttpResponse.json({ code: 0, message: '解封成功', data: null });
  }),

  http.post('/api/rate-limit/reset-stats', async ({ request }) => {
    const { name } = await request.json() as { name: string };
    const bucket = stats[name as keyof typeof stats];
    if (bucket) { bucket.hit = 0; bucket.blocked = 0; bucket.recent = []; }
    return HttpResponse.json({ code: 0, message: '统计已清空', data: null });
  }),
];
