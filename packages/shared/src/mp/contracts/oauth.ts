import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { buildMpOAuthUrlSchema } from '../../identity/validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpOAuthUrlSchema = z.object({
  url: z.string().meta({ description: '微信网页授权跳转链接' }),
}).meta({ id: 'MpOAuthUrl' });

export type MpOAuthUrl = z.infer<typeof mpOAuthUrlSchema>;

/** 网页授权回调结果：snsapi_userinfo 时附带用户信息 */
export const mpOAuthResultSchema = z.object({
  openid: z.string(),
  unionid: z.string().nullable(),
  scope: z.string(),
  userInfo: z.object({
    nickname: z.string().optional(),
    sex: z.number().optional(),
    province: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
    headimgurl: z.string().optional(),
  }).nullable(),
}).meta({ id: 'MpOAuthResult' });

export type MpOAuthResult = z.infer<typeof mpOAuthResultSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

/** `{accountId}` 路径参数：公众号 ID */
export const mpAccountIdParam = z.object({
  accountId: z.coerce.number().int().positive().meta({ description: '公众号 ID', example: 1 }),
});

export const mpOAuthCallbackQuery = z.object({
  code: z.string().min(1, '缺少 code').meta({ description: '微信回跳携带的授权 code' }),
  state: z.string().optional(),
});

// ─── 契约：管理端 ────────────────────────────────────────────────────────────

export const mpOAuthContract = defineContract('/api/mp/oauth', {
  buildUrl: op.post('/url', {
    body: buildMpOAuthUrlSchema,
    response: mpOAuthUrlSchema,
    summary: '生成网页授权链接',
    description: '生成 OAuth2 网页授权跳转链接（snsapi_base / snsapi_userinfo），用于 H5 集成或测试。',
  }),
}, { tags: ['公众号网页授权'] });

// ─── 契约：授权回调（公开，微信在用户授权后回跳） ─────────────────────────────

export const mpOAuthPublicContract = defineContract('/api/public/mp/oauth', {
  callback: op.get('/{accountId}', {
    params: mpAccountIdParam,
    query: mpOAuthCallbackQuery,
    response: mpOAuthResultSchema,
    public: true,
    summary: '网页授权回调（公开，无需登录）',
    description: '微信在用户授权后回跳此地址并带上 code，服务端用 code 换取 openid/unionid（及用户信息）。',
  }),
}, { tags: ['公众号网页授权（公开）'] });
