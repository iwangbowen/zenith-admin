import { matchesFilter } from '@/mocks/utils/filter';
import {
  DEFAULT_RATE_LIMIT_RULES,
  CODE_RATE_LIMIT_NAMES,
  rateLimitMatches,
  rateLimitPathMatches,
  selectRateLimitRule,
  rateLimitContract,
  type RateLimitBan,
  type RateLimitRecentBlock,
  type RateLimitRule,
} from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound, nextIdFrom } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset } from '../utils/date';
import { removeByIds, requireItem } from '../utils/crud';

const RULE_BASE = {
  mode: 'enforce' as const,
  algorithm: 'fixed_window' as const,
  allowlist: [] as string[],
  priority: 0,
  alertThreshold: null,
};

const rules: RateLimitRule[] = Object.values(DEFAULT_RATE_LIMIT_RULES).map((rule, i) => ({
  ...rule,
  id: i + 1,
  predefined: true,
  mountSource: CODE_RATE_LIMIT_NAMES.some((name) => name === rule.name) ? ('code' as const) : ('path' as const),
  methods: [],
  extraWindows: [],
  failMode: 'open' as const,
  loadState: 'loaded' as const,
  createdAt: mockDateTime(),
  updatedAt: mockDateTime(),
}));
const operations = [
  { method: 'POST', path: '/api/auth/login', summary: '后台登录', security: 'none' },
  { method: 'GET', path: '/api/users/{id}', summary: '查询用户', security: 'bearer' },
];

const stats: Record<string, { hit: number; blocked: number; recent: RateLimitRecentBlock[] }> = {
  auth: {
    hit: 8421,
    blocked: 12,
    recent: [
      {
        at: mockDateTimeOffset(-5 * 60 * 1000),
        key: '203.0.113.42',
        path: '/api/auth/login',
        monitored: false,
        banned: false,
      },
      {
        at: mockDateTimeOffset(-22 * 60 * 1000),
        key: '198.51.100.7',
        path: '/api/auth/login',
        monitored: false,
        banned: true,
      },
    ],
  },
  captcha: {
    hit: 12034,
    blocked: 3,
    recent: [
      {
        at: mockDateTimeOffset(-1 * 60 * 60 * 1000),
        key: '192.0.2.55',
        path: '/api/auth/captcha',
        monitored: false,
        banned: false,
      },
    ],
  },
  sensitive: { hit: 187, blocked: 0, recent: [] },
  chat_send: {
    hit: 4560,
    blocked: 1,
    recent: [
      {
        at: mockDateTimeOffset(-40 * 60 * 1000),
        key: 'u:2',
        path: '/api/chat/conversations/1/messages',
        monitored: false,
        banned: false,
      },
    ],
  },
  report_public_share: {
    hit: 960,
    blocked: 4,
    recent: [
      {
        at: mockDateTimeOffset(-12 * 60 * 1000),
        key: '198.51.100.23',
        path: '/api/report/public/abc',
        monitored: true,
        banned: false,
      },
    ],
  },
};

const activeBans: RateLimitBan[] = [
  { name: 'auth', key: '198.51.100.7', expiresAt: mockDateTimeOffset(3600 * 1000), remainingSeconds: 3600 },
];

function mountSourceOf(rule: RateLimitRule): RateLimitRule['mountSource'] {
  const code = rule.mountSource === 'code' || rule.mountSource === 'code_path';
  const path = rule.pathPatterns.length > 0;
  if (code && path) return 'code_path';
  if (code) return 'code';
  if (path) return 'path';
  return 'none';
}

export const rateLimitHandlers = [
  mock(rateLimitContract.operations, ({ ok }) => ok(operations)),
  mock(rateLimitContract.diagnose, ({ body, ok }) => {
    const selected = [
      selectRateLimitRule(rules, body.method, body.path, false),
      body.principal === 'anonymous' ? undefined : selectRateLimitRule(rules, body.method, body.path, true),
    ]
      .filter(Boolean)
      .map((rule) => rule!.name);
    return ok({
      method: body.method,
      path: operations.find((op) => rateLimitPathMatches(op.path, body.path))?.path ?? '/[unmatched]',
      selected,
      matches: rules
        .filter((rule) => rateLimitMatches(rule, body.method, body.path))
        .map((rule) => ({
          name: rule.name,
          selected: selected.includes(rule.name),
          stage: rule.keyType === 'user' ? '认证后' : '认证前',
          reason: selected.includes(rule.name) ? '匹配选中' : '停用或被覆盖',
        })),
      note: 'Demo配置匹配，不消耗真实额度',
    });
  }),
  mock(rateLimitContract.events, ({ query, ok }) => {
    const rows = Object.entries(stats)
      .flatMap(([name, value]) =>
        value.recent.map((event, i) => ({
          ...event,
          name,
          id: name + '-' + i,
          decision: event.monitored
            ? ('monitored' as const)
            : event.banned
              ? ('banned' as const)
              : ('blocked' as const),
          method: 'POST',
          correlationId: null,
        })),
      )
      .filter(
        (event) =>
          (!query.name || event.name.includes(query.name)) &&
          (!query.keyword || event.key.includes(query.keyword) || event.path.includes(query.keyword)) &&
          matchesFilter(event.decision, query.decision),
      );
    return ok({
      list: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      total: rows.length,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
  mock(rateLimitContract.detailStats, ({ params, ok }) => {
    const rule = requireItem(rules, params.id, '规则不存在', { status: 404 });
    const value = stats[rule.name] ?? { hit: 0, blocked: 0, recent: [] };
    return ok({
      ...rule,
      hitCount: value.hit,
      blockedCount: value.blocked,
      blockRate: 0,
      recentBlocks: value.recent,
      hourlySeries: [],
      dailySeries: [],
      topSources: [],
    });
  }),
  mock(rateLimitContract.rules, ({ ok }) =>
    ok(
      rules.map((r) => ({ ...r, mountSource: mountSourceOf(r) })),
      'success',
    ),
  ),

  mock(rateLimitContract.updateRule, ({ params, body, ok }) => {
    const idx = rules.findIndex((r) => r.id === params.id);
    if (idx === -1) return notFound('规则不存在', { status: 404 });
    rules[idx] = { ...rules[idx], ...body, updatedAt: mockDateTime() };
    rules[idx].mountSource = mountSourceOf(rules[idx]);
    return ok(rules[idx], '规则已更新');
  }),

  mock(rateLimitContract.createRule, ({ body, ok }) => {
    const existing = rules.find((r) => r.name === body.name);
    if (existing) return badRequest(`规则名称 "${body.name}" 已存在`, { status: 400 });
    const newRule: RateLimitRule = {
      ...RULE_BASE,
      ...body,
      description: body.description ?? null,
      alertThreshold: body.alertThreshold ?? null,
      blockedMessage: body.blockedMessage ?? null,
      pathPatterns: body.pathPatterns ?? [],
      id: nextIdFrom(rules),
      predefined: false,
      mountSource: (body.pathPatterns ?? []).length > 0 ? 'path' : 'none',
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    rules.push(newRule);
    return ok(newRule, '规则已创建');
  }),

  mock(rateLimitContract.removeRule, ({ params, ok }) => {
    const item = requireItem(rules, params.id, '规则不存在', { status: 404 });
    if (item.predefined) {
      return badRequest('内置规则不可删除', { status: 400 });
    }
    removeByIds(rules, [params.id]);
    return ok(null, '规则已删除');
  }),

  mock(rateLimitContract.stats, ({ ok }) => {
    const items = rules.map((r) => {
      const s = stats[r.name] ?? { hit: 0, blocked: 0, recent: [] };
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
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dailySeries = Array.from({ length: 30 }, (_, i) => {
        const t = new Date(dayStart.getTime() - (29 - i) * 24 * 3600 * 1000);
        const mm = String(t.getMonth() + 1).padStart(2, '0');
        const dd = String(t.getDate()).padStart(2, '0');
        return {
          day: `${mm}-${dd}`,
          hits: r.enabled ? Math.floor(Math.random() * 8000) + 500 : 0,
          blocked: r.enabled ? Math.floor(Math.random() * 40) : 0,
        };
      });
      const topSources =
        s.blocked > 0 ? s.recent.slice(0, 5).map((b, i) => ({ key: b.key, count: Math.max(1, s.blocked - i) })) : [];
      return {
        name: r.name,
        description: r.description,
        windowMs: r.windowMs,
        limit: r.limit,
        keyType: r.keyType,
        enabled: r.enabled,
        mode: r.mode,
        hitCount: s.hit,
        blockedCount: s.blocked,
        blockRate: s.hit > 0 ? Math.round((s.blocked / s.hit) * 10000) / 100 : 0,
        recentBlocks: s.recent,
        hourlySeries,
        dailySeries,
        topSources,
      };
    });
    return ok({ items }, 'success');
  }),

  mock(rateLimitContract.unblock, ({ body, ok }) => {
    const { name, key } = body;
    const bucket = stats[name];
    const had = bucket ? bucket.recent.some((b) => b.key === key) : false;
    if (bucket) bucket.recent = bucket.recent.filter((b) => b.key !== key);
    return ok(null, had ? '解封成功' : '未找到活跃计数窗口（可能已过期或已解封）');
  }),

  mock(rateLimitContract.resetStats, ({ body, ok }) => {
    const { name } = body;
    const bucket = stats[name];
    if (bucket) {
      bucket.hit = 0;
      bucket.blocked = 0;
      bucket.recent = [];
    }
    return ok(null, '统计已清空');
  }),

  mock(rateLimitContract.bans, ({ ok }) => ok(activeBans, 'success')),

  mock(rateLimitContract.ban, ({ body, ok }) => {
    const { name, key, durationSeconds } = body;
    const existing = activeBans.findIndex((b) => b.name === name && b.key === key);
    if (existing >= 0) activeBans.splice(existing, 1);
    activeBans.push({
      name,
      key,
      expiresAt: mockDateTimeOffset(durationSeconds * 1000),
      remainingSeconds: durationSeconds,
    });
    return ok(null, '封禁成功');
  }),

  mock(rateLimitContract.unban, ({ body, ok }) => {
    const { name, key } = body;
    const idx = activeBans.findIndex((b) => b.name === name && b.key === key);
    const had = idx >= 0;
    if (had) activeBans.splice(idx, 1);
    return ok(null, had ? '已解除封禁' : '封禁不存在或已过期');
  }),
];
