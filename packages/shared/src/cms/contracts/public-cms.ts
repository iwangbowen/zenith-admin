import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  CMS_INTERACTION_CAPTCHA_POLICIES,
  CMS_INTERACTION_KINDS,
  CMS_INTERACTION_PARTICIPANT_SCOPES,
  CMS_INTERACTION_REPEAT_POLICIES,
  CMS_INTERACTION_RESOLVED_CAPTCHA_PROVIDERS,
  CMS_INTERACTION_RESULT_VISIBILITIES,
  CMS_INTERACTION_STATUSES,
} from '../constants';
import { issueCmsAdEventTokensSchema, submitCmsInteractionSchema } from '../validation';
import {
  cmsInteractionPublicStatsSchema,
  cmsInteractionQuestionViewSchema,
  cmsInteractionSubmitResultSchema,
} from './interactions';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 前台图形验证码（算术题 SVG，答案一次性校验） */
export const cmsCaptchaChallengeSchema = z.object({
  id: z.string(),
  svg: z.string().meta({ description: '内联 SVG（前台直接插入 DOM）' }),
}).meta({ id: 'CmsCaptchaChallenge' });

export type CmsCaptchaChallenge = z.infer<typeof cmsCaptchaChallengeSchema>;

/** 互动问卷生效的验证码配置（不含 secret） */
export const cmsInteractionCaptchaConfigSchema = z.object({
  provider: z.enum(CMS_INTERACTION_RESOLVED_CAPTCHA_PROVIDERS),
  siteKey: z.string().nullable(),
}).meta({ id: 'CmsInteractionCaptchaConfig' });

export type CmsInteractionCaptchaConfig = z.infer<typeof cmsInteractionCaptchaConfigSchema>;

/** 前台互动问卷视图：定义 + 当前访客的参与状态与结果可见性 */
export const cmsInteractionPublicStateSchema = z.object({
  interaction: z.object({
    id: z.int(),
    siteId: z.int(),
    code: z.string(),
    kind: z.enum(CMS_INTERACTION_KINDS),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(CMS_INTERACTION_STATUSES),
    participantScope: z.enum(CMS_INTERACTION_PARTICIPANT_SCOPES),
    repeatPolicy: z.enum(CMS_INTERACTION_REPEAT_POLICIES),
    resultVisibility: z.enum(CMS_INTERACTION_RESULT_VISIBILITIES),
    captchaPolicy: z.enum(CMS_INTERACTION_CAPTCHA_POLICIES),
    thankYouMessage: z.string(),
    startAt: z.string().nullable(),
    endAt: z.string().nullable(),
    questions: z.array(cmsInteractionQuestionViewSchema),
  }),
  open: z.boolean(),
  submitted: z.boolean(),
  captchaRequired: z.boolean(),
  captcha: cmsInteractionCaptchaConfigSchema,
  resultsVisible: z.boolean(),
  results: cmsInteractionPublicStatsSchema.nullable(),
}).meta({ id: 'CmsInteractionPublicState' });

export type CmsInteractionPublicState = z.infer<typeof cmsInteractionPublicStateSchema>;

/** 广告事件一次性令牌（曝光必发，点击仅对可跳转广告签发） */
export const cmsAdEventTokensSchema = z.object({
  adId: z.int(),
  viewToken: z.string(),
  clickToken: z.string().nullable(),
}).meta({ id: 'CmsAdEventTokens' });

export type CmsAdEventTokens = z.infer<typeof cmsAdEventTokensSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const publicCmsSiteCodeParam = z.object({
  siteCode: z.string().min(1).max(50).meta({ description: '站点标识', example: 'main' }),
});

export const publicCmsInteractionParam = publicCmsSiteCodeParam.extend({
  code: z.string().min(1).max(50).meta({ description: '互动标识', example: 'product-feedback-2026' }),
});

// ─── 契约（前台匿名接口；会员登录态可选） ────────────────────────────────────

export const publicCmsContract = defineContract('/api/public/cms', {
  captcha: op.get('/captcha', { public: true, response: cmsCaptchaChallengeSchema, summary: '前台图形验证码（站点开启验证码时评论 / 表单提交必须携带）' }),
  interaction: op.get('/interactions/{siteCode}/{code}', { public: true, params: publicCmsInteractionParam, response: cmsInteractionPublicStateSchema, summary: '互动问卷定义与当前访客参与状态' }),
  submitInteraction: op.post('/interactions/{siteCode}/{code}/submit', { public: true, params: publicCmsInteractionParam, body: submitCmsInteractionSchema, response: cmsInteractionSubmitResultSchema, summary: '提交互动问卷（游客或可选会员登录态）' }),
  issueAdTokens: op.post('/ads/tokens/{siteCode}', { public: true, params: publicCmsSiteCodeParam, body: issueCmsAdEventTokensSchema, response: z.array(cmsAdEventTokensSchema), summary: '签发广告事件令牌（短期、一次性并绑定站点/广告/页面/访客）' }),
}, { tags: ['CMS-前台公开接口'] });
