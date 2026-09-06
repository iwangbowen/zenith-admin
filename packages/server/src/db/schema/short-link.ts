/**
 * 短链服务（short-link 域）
 *
 * - short_links            短链主表（code 全局唯一，跨租户不重复）
 * - short_link_clicks      点击明细（追加型日志，供统计与审计，保留策略管控）
 * - short_link_daily_stats 按日聚合（P2 起由定时任务物化，长周期趋势与明细瘦身后的数据源）
 */
import { pgTable, pgEnum, varchar, timestamp, integer, text, boolean, date, index, uniqueIndex, bigint } from 'drizzle-orm/pg-core';
import { statusEnum, timestampColumns } from './common';
import { auditColumns, tenants } from './core';

/** 跳转方式：302 临时（默认，可统计可改址）/ 301 永久（浏览器缓存，改址不生效） */
export const shortLinkRedirectTypeEnum = pgEnum('short_link_redirect_type', ['302', '301']);

export const shortLinks = pgTable('short_links', {
  id:           integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 短码，全局唯一（多租户下也不重复，跳转按 code 寻址） */
  code:         varchar({ length: 32 }).notNull().unique(),
  targetUrl:    text().notNull(),
  title:        varchar({ length: 128 }),
  redirectType: shortLinkRedirectTypeEnum().notNull().default('302'),
  status:       statusEnum().notNull().default('enabled'),
  /** 过期时间，null = 永久有效 */
  expiresAt:    timestamp(),
  /** 访问次数上限，null = 不限 */
  maxVisits:    integer(),
  /** 访问密码（提取码语义，需在管理端可见可复制），null = 无需密码 */
  password:     varchar({ length: 32 }),
  utmSource:    varchar({ length: 128 }),
  utmMedium:    varchar({ length: 128 }),
  utmCampaign:  varchar({ length: 128 }),
  utmTerm:      varchar({ length: 128 }),
  utmContent:   varchar({ length: 128 }),
  /** 来源业务类型（custom = 手工创建；其余由业务域经 ensureShortLink 写入） */
  bizType:      varchar({ length: 32 }).notNull().default('custom'),
  /** 来源业务标识（与 bizType 组合定位业务对象，幂等复用） */
  bizRef:       varchar({ length: 64 }),
  remark:       varchar({ length: 256 }),
  /** 累计访问次数（不含爬虫，异步点击落库时递增，maxVisits 判定依据） */
  totalPv:      integer().notNull().default(0),
  lastVisitAt:  timestamp(),
  tenantId:     integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  index('idx_short_links_biz').on(t.bizType, t.bizRef),
  index('idx_short_links_tenant').on(t.tenantId),
]);

export type ShortLinkRow = typeof shortLinks.$inferSelect;

export type NewShortLink = typeof shortLinks.$inferInsert;

export const shortLinkClicks = pgTable('short_link_clicks', {
  id:         bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  linkId:     integer().notNull().references(() => shortLinks.id, { onDelete: 'cascade' }),
  /** 访客指纹 hash(ip + ua)，无 Cookie 方案，UV 按日去重口径 */
  visitorId:  varchar({ length: 40 }),
  ip:         varchar({ length: 64 }),
  country:    varchar({ length: 64 }),
  province:   varchar({ length: 64 }),
  city:       varchar({ length: 64 }),
  deviceType: varchar({ length: 16 }),
  os:         varchar({ length: 64 }),
  browser:    varchar({ length: 64 }),
  referer:    varchar({ length: 512 }),
  isBot:      boolean().notNull().default(false),
  clickedAt:  timestamp().defaultNow().notNull(),
}, (t) => [
  index('idx_short_link_clicks_link_time').on(t.linkId, t.clickedAt),
]);

export type ShortLinkClickRow = typeof shortLinkClicks.$inferSelect;

export type NewShortLinkClick = typeof shortLinkClicks.$inferInsert;

export const shortLinkDailyStats = pgTable('short_link_daily_stats', {
  id:       integer().primaryKey().generatedAlwaysAsIdentity(),
  linkId:   integer().notNull().references(() => shortLinks.id, { onDelete: 'cascade' }),
  statDate: date().notNull(),
  pv:       integer().notNull().default(0),
  uv:       integer().notNull().default(0),
}, (t) => [
  uniqueIndex('uq_short_link_daily_stats_link_date').on(t.linkId, t.statDate),
]);

export type ShortLinkDailyStatRow = typeof shortLinkDailyStats.$inferSelect;

export type NewShortLinkDailyStat = typeof shortLinkDailyStats.$inferInsert;
