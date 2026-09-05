import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { RULE_REF_KINDS } from '../../rules/constants';
import { shortLinkSchema, shortLinkStatsQuery, shortLinkStatsSchema } from '../../short-link/contracts/short-links';
import { OPEN_APP_ENVIRONMENTS, OPEN_AUTH_CHANNELS } from '../constants';
import { openRuleEvaluateSchema, openShortLinkCreateSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 连通性测试结果 */
export const openGatewayPingSchema = z.object({
  pong: z.boolean(),
  app: z.string().nullable().meta({ description: '调用应用名称' }),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  channel: z.enum(OPEN_AUTH_CHANNELS).nullable(),
  time: z.string().meta({ description: '服务端时间 YYYY-MM-DD HH:mm:ss' }),
}).meta({ id: 'OpenGatewayPing' });

export type OpenGatewayPing = z.infer<typeof openGatewayPingSchema>;

/** 查询参数回显 */
export const openGatewayQueryEchoSchema = z.object({
  query: z.record(z.string(), z.string()),
}).meta({ id: 'OpenGatewayQueryEcho' });

export type OpenGatewayQueryEcho = z.infer<typeof openGatewayQueryEchoSchema>;

/** 请求体回显 */
export const openGatewayBodyEchoSchema = z.object({
  body: z.unknown().meta({ description: '原样回显的 JSON 请求体' }),
}).meta({ id: 'OpenGatewayBodyEcho' });

export type OpenGatewayBodyEcho = z.infer<typeof openGatewayBodyEchoSchema>;

/** 当前调用主体（应用 + 鉴权通道 + 有效 scope） */
export const openGatewayPrincipalSchema = z.object({
  appKey: z.string().nullable(),
  appName: z.string().nullable(),
  environment: z.enum(OPEN_APP_ENVIRONMENTS),
  channel: z.enum(OPEN_AUTH_CHANNELS).nullable(),
  userId: z.int().nullable().meta({ description: '用户授权令牌对应的用户；client_credentials 与签名通道为 null' }),
  scopes: z.array(z.string()).meta({ description: '本次调用的有效 scope（已与应用允许范围取交集）' }),
}).meta({ id: 'OpenGatewayPrincipal' });

export type OpenGatewayPrincipal = z.infer<typeof openGatewayPrincipalSchema>;

/** 规则中心统一求值结论（开放 API 视角的精简形状） */
export const openRuleDecisionSchema = z.object({
  matched: z.boolean(),
  outputs: z.record(z.string(), z.unknown()),
  ref: z.object({
    kind: z.enum(RULE_REF_KINDS),
    key: z.string(),
    version: z.int().nullable().meta({ description: '实际求值的发布版本；名单无版本概念，为 null' }),
  }),
  reason: z.enum(['no_match', 'unique_conflict', 'any_conflict', 'not_found', 'error']).optional()
    .meta({ description: 'matched=false 的原因' }),
  usedFallback: z.boolean().optional().meta({ description: '决策表未命中但按设置回退了默认输出' }),
}).meta({ id: 'OpenRuleDecision' });

export type OpenRuleDecision = z.infer<typeof openRuleDecisionSchema>;

/** 开放应用创建的短链（短链实体的对外子集） */
export const openShortLinkSchema = shortLinkSchema.pick({
  code: true,
  shortUrl: true,
  targetUrl: true,
  expiresAt: true,
}).meta({ id: 'OpenShortLink' });

export type OpenShortLink = z.infer<typeof openShortLinkSchema>;

/** 短链访问统计（汇总与趋势） */
export const openShortLinkStatsSchema = shortLinkSchema.pick({ code: true, shortUrl: true })
  .extend(shortLinkStatsSchema.pick({ totals: true, trend: true }).shape)
  .meta({ id: 'OpenShortLinkStats' });

export type OpenShortLinkStats = z.infer<typeof openShortLinkStatsSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const openShortLinkCodeParam = z.object({
  code: z.string().min(1).meta({ description: '短码', example: 'aB3xY7k' }),
});

/**
 * 开放 API 网关核心端点。鉴权 / 计量 / 限流由网关中间件统一施加
 * （OAuth2 令牌或 AppKey + HMAC 签名二选一），各端点只声明所需 scope；
 * CMS / IoT / 支付子端点归属各自领域。
 */
export const openGatewayContract = defineContract('/api/open', {
  ping: op.get('/v1/ping', { security: 'open-gateway', response: openGatewayPingSchema, summary: '连通性测试', description: '无需 scope。' }),
  echoQuery: op.get('/v1/echo', { security: 'open-gateway', response: openGatewayQueryEchoSchema, summary: '查询参数回显', description: '所需 scope：data:read。' }),
  echoBody: op.post('/v1/echo', {
    security: 'open-gateway',
    body: z.unknown().meta({ description: '任意 JSON 请求体' }),
    response: openGatewayBodyEchoSchema,
    summary: '请求体回显（验证 body 参与签名）',
    description: '所需 scope：data:write。',
  }),
  userinfo: op.get('/v1/userinfo', { security: 'open-gateway', response: openGatewayPrincipalSchema, summary: '当前调用主体信息', description: '所需 scope：user:read。' }),
  evaluateRule: op.post('/v1/rules/evaluate', {
    security: 'open-gateway',
    body: openRuleEvaluateSchema,
    response: openRuleDecisionSchema,
    summary: '规则中心统一求值（决策表/决策流/评分卡/名单）',
    description: '所需 scope：rules:evaluate。只允许求值已发布的平台级资产；kind=list 需传 subjects（待检测主体值集合）。',
  }),
  createShortLink: op.post('/v1/short-links', {
    security: 'open-gateway',
    body: openShortLinkCreateSchema,
    response: openShortLinkSchema,
    summary: '生成短链（支持自定义短码/有效期）',
    description: '所需 scope：data:write。',
  }),
  shortLinkStats: op.get('/v1/short-links/{code}/stats', {
    security: 'open-gateway',
    params: openShortLinkCodeParam,
    query: shortLinkStatsQuery,
    response: openShortLinkStatsSchema,
    summary: '短链访问统计（汇总与趋势）',
    description: '所需 scope：data:read。',
  }),
}, { tags: ['开放 API · 网关'] });
