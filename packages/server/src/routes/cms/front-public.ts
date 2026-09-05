import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { publicCmsContract, submitCmsCommentSchema } from '@zenith/shared/cms';
import { defineContractRoute } from '../../lib/contract-route';
import { errBody, okBody, validationHook } from '../../lib/openapi-schemas';
import { resolveSiteByCode } from '../../services/cms/cms-sites.service';
import { getCmsCommentSite, submitCmsComment, likeCmsComment, throttleFrontSubmit } from '../../services/cms/cms-comments.service';
import { getCmsFormByCode, submitCmsForm } from '../../services/cms/cms-forms.service';
import { increaseViewCount } from '../../services/cms/cms-contents.service';
import {
  recordCmsAdClick,
  recordCmsAdImpressions,
} from '../../services/cms/cms-ad-events.service';
import {
  consumeCmsAdEventToken,
  consumeCmsAdEventTokens,
  issueCmsAdEventTokens,
  releaseCmsAdEventToken,
  throttleCmsAdTokenIssue,
  type CmsAdEventTokenPayload,
} from '../../services/cms/cms-ad-event-token.service';
import { generateCmsCaptcha, verifyCmsCaptcha, isCaptchaEnabled } from '../../services/cms/cms-captcha.service';
import {
  getCmsInteractionPublicState,
  getPublicCmsInteractionByCode,
  submitCmsInteraction,
} from '../../services/cms/cms-interactions.service';
import { config } from '../../config';
import redis from '../../lib/redis';
import { optionalMemberSessionMiddleware } from '../../middleware/optional-member-session';
import { getClientIp } from '../../lib/request-helpers';
import { hashCmsIp } from '../../services/cms/cms-visitor';
import { escapeHtml } from '@zenith/shared/core';
import { safeReturnUrl } from '../../lib/safe-return-url';

/**
 * CMS 前台公开接口（评论 / 自定义表单 / 互动问卷 / 广告事件 / 浏览计数）。
 * JSON 端点由 `publicCmsContract` 定义；原生 HTML form POST（零 JS）返回轻量提示页并跳回来源页，
 * 302 中转与 204 beacon 不进入契约。
 * 防护：Redis IP 限流 + 蜜罐字段 + 敏感词过滤（service 层）。
 */

/** 轻量提示页：2 秒后 meta refresh 跳回来源页 */
function messagePage(title: string, text: string, backUrl: string): string {
  const safeBack = escapeHtml(backUrl);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="2;url=${safeBack}"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f8fa}main{text-align:center;padding:40px;background:#fff;border:1px solid #d1d9e0;border-radius:10px}h1{font-size:20px;margin:0 0 8px}p{color:#59636e;font-size:14px;margin:0 0 16px}a{color:#1f6feb}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><a href="${safeBack}">立即返回</a></main></body></html>`;
}


/** 站点开启验证码时校验（一次性）；未开启直接放行 */
async function assertCaptchaIfEnabled(site: { settings: unknown } | null, body: Record<string, unknown>): Promise<string | null> {
  if (!site || !isCaptchaEnabled(site as Parameters<typeof isCaptchaEnabled>[0])) return null;
  const passed = await verifyCmsCaptcha(
    typeof body.captchaId === 'string' ? body.captchaId : undefined,
    typeof body.captchaAnswer === 'string' ? body.captchaAnswer : undefined,
  );
  return passed ? null : '验证码错误或已过期，请重试';
}

export function createCmsFrontPublicRoutes() {
  const app = new OpenAPIHono({ defaultHook: validationHook });
  app.use('*', optionalMemberSessionMiddleware);

  // ─── 图形验证码（站点开启 captchaEnabled 时评论/表单提交必须携带）──────────────
  const captchaRoute = defineContractRoute(publicCmsContract.captcha, {
    middleware: [],
    handler: async (c) => {
      const ip = getClientIp(c);
      await throttleFrontSubmit(ip).catch(() => undefined);
      const challenge = await generateCmsCaptcha();
      return c.json(okBody(challenge, 'ok'), 200);
    },
  });

  // ─── 统一互动问卷：查询与结果可见性 ─────────────────────────────────────────
  const interactionRoute = defineContractRoute(publicCmsContract.interaction, {
    middleware: [],
    handler: async (c) => {
      const { siteCode, code } = c.req.valid('param');
      const site = await resolveSiteByCode(siteCode);
      if (!site) return c.json(errBody('站点不存在', 404), 404);
      const interaction = await getPublicCmsInteractionByCode(site.id, code);
      if (!interaction) return c.json(errBody('互动问卷不存在', 404), 404);
      const state = await getCmsInteractionPublicState(interaction, {
        memberId: c.get('member')?.memberId ?? null,
        ip: getClientIp(c),
      });
      return c.json(okBody(state, 'ok'), 200);
    },
  });

  // ─── 统一互动问卷：公开/可选会员提交 ─────────────────────────────────────────
  const submitInteractionRoute = defineContractRoute(publicCmsContract.submitInteraction, {
    middleware: [],
    handler: async (c) => {
      const { siteCode, code } = c.req.valid('param');
      const site = await resolveSiteByCode(siteCode);
      if (!site) return c.json(errBody('站点不存在', 404), 404);
      const interaction = await getPublicCmsInteractionByCode(site.id, code);
      if (!interaction) return c.json(errBody('互动问卷不存在', 404), 404);
      const ip = getClientIp(c);
      try {
        await throttleFrontSubmit(ip);
        const result = await submitCmsInteraction(interaction, c.req.valid('json'), {
          memberId: c.get('member')?.memberId ?? null,
          ip,
          userAgent: c.req.header('user-agent') ?? null,
          idempotencyKey: c.req.header('x-idempotency-key') ?? null,
        });
        return c.json(okBody(result, result.message), 200);
      } catch (err) {
        const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
        const status = err instanceof HTTPException ? err.status : 500;
        return c.json(errBody(msg, status), status as 400);
      }
    },
  });

  // ─── 广告事件令牌：短期、一次性并绑定站点/广告/页面/访客 ───────────────────
  const issueAdTokensRoute = defineContractRoute(publicCmsContract.issueAdTokens, {
    middleware: [],
    handler: async (c) => {
      c.header('Cache-Control', 'no-store');
      const ip = getClientIp(c);
      try {
        await throttleCmsAdTokenIssue(ip);
        const tokens = await issueCmsAdEventTokens({
          siteCode: c.req.valid('param').siteCode,
          ads: c.req.valid('json').ads,
          host: c.req.header('host') ?? null,
          memberId: c.get('member')?.memberId ?? null,
          ip,
          userAgent: c.req.header('user-agent') ?? null,
        });
        return c.json(okBody(tokens, 'ok'), 200);
      } catch (error) {
        const status = error instanceof HTTPException ? error.status : 500;
        const message = error instanceof HTTPException ? error.message : '广告事件令牌签发失败';
        return c.json(errBody(message, status), status as 400);
      }
    },
  });

  app.openapiRoutes([captchaRoute, interactionRoute, submitInteractionRoute, issueAdTokensRoute] as const);

  // ─── 评论提交 ───────────────────────────────────────────────────────────────
  app.post('/comments', async (c) => {
    const body = await c.req.parseBody();
    const backUrl = safeReturnUrl(body.returnUrl);
    const parsed = submitCmsCommentSchema.safeParse({
      contentId: body.contentId,
      nickname: body.nickname,
      content: body.content,
      parentId: body.parentId || undefined,
      website: body.website || undefined,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? '提交参数有误';
      return c.newResponse(messagePage('提交失败', msg, backUrl), 400, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    try {
      const site = await getCmsCommentSite(parsed.data.contentId);
      const captchaError = await assertCaptchaIfEnabled(site, body as Record<string, unknown>);
      if (captchaError) {
        return c.newResponse(messagePage('提交失败', captchaError, backUrl), 400, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      await submitCmsComment({
        contentId: parsed.data.contentId,
        nickname: parsed.data.nickname,
        content: parsed.data.content,
        parentId: parsed.data.parentId,
        ip: getClientIp(c),
        userAgent: c.req.header('user-agent')?.slice(0, 255) ?? null,
      });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
      const status = err instanceof HTTPException ? err.status : 500;
      return c.newResponse(messagePage('提交失败', msg, backUrl), status, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    return c.newResponse(messagePage('评论已提交', '审核通过后将显示在页面上。', backUrl), 200, { 'Content-Type': 'text/html; charset=utf-8' });
  });

  // ─── 自定义表单提交 ─────────────────────────────────────────────────────────
  app.post('/forms/:siteCode/:formCode', async (c) => {
    const body = await c.req.parseBody();
    const backUrl = safeReturnUrl(body.returnUrl);
    const respond = (title: string, text: string, status: 200 | 400 | 404 | 429 | 500 = 200) =>
      c.newResponse(messagePage(title, text, backUrl), status, { 'Content-Type': 'text/html; charset=utf-8' });

    if (typeof body.website === 'string' && body.website) {
      return respond('提交失败', '提交被拒绝', 400);
    }
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return respond('提交失败', '站点不存在', 404);
    const form = await getCmsFormByCode(site.id, c.req.param('formCode'));
    if (!form) return respond('提交失败', '表单不存在或已停用', 404);
    try {
      await submitCmsForm({
        form,
        site,
        raw: body,
        ip: getClientIp(c),
        userAgent: c.req.header('user-agent')?.slice(0, 255) ?? null,
      });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
      const status = err instanceof HTTPException ? (err.status as 400 | 429) : 500;
      return respond('提交失败', msg, status);
    }
    return respond('提交成功', form.successMessage?.trim() || '我们已收到您的信息。');
  });

  // ─── 评论点赞（同 IP 对同评论 24h 去重；原生 form POST，处理后跳回来源页）─────
  app.post('/comments/:id/like', async (c) => {
    const body = await c.req.parseBody();
    const backUrl = safeReturnUrl(body.returnUrl);
    const commentId = Number(c.req.param('id')) || 0;
    if (commentId > 0) {
      const ip = getClientIp(c);
      await throttleFrontSubmit(ip).catch(() => undefined);
      await likeCmsComment(commentId, ip).catch(() => undefined);
    }
    return c.redirect(backUrl, 302);
  });

  // ─── 广告点击中转（令牌验证 + 计数后 302 跳转安全目标）──────────────────────
  app.get('/ads/:id/click', async (c) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const adId = Number(c.req.param('id')) || 0;
    const token = c.req.query('token') ?? '';
    const ip = getClientIp(c);
    let payload: CmsAdEventTokenPayload;
    try {
      payload = await consumeCmsAdEventToken(token, {
        eventType: 'click',
        adId,
        ip,
        userAgent: c.req.header('user-agent') ?? null,
      });
    } catch (error) {
      const status = error instanceof HTTPException ? error.status : 403;
      return c.text(error instanceof HTTPException ? error.message : '广告事件令牌无效', status);
    }
    const referrer = c.req.header('referer') ?? null;
    let linkUrl: string | null;
    try {
      linkUrl = adId > 0 ? await recordCmsAdClick(adId, {
        ip,
        userAgent: c.req.header('user-agent') ?? null,
        referrer,
        path: payload.path,
        memberId: payload.memberId,
        expectedSiteId: payload.siteId,
      }) : null;
    } catch (error) {
      await releaseCmsAdEventToken(payload);
      throw error;
    }
    if (!linkUrl) return c.text('广告不存在或未投放', 404);
    return c.redirect(linkUrl, 302);
  });

  // ─── 广告曝光 beacon（一次性令牌 + 事件时间桶双重防刷）─────────────────────
  app.post('/ads/view', async (c) => {
    c.header('Cache-Control', 'no-store');
    let tokens: string[];
    try {
      const body = await c.req.json<{ tokens?: string[] }>();
      tokens = Array.isArray(body?.tokens)
        ? [...new Set(body.tokens.filter((token) => typeof token === 'string' && token.length <= 4096))].slice(0, 50)
        : [];
    } catch {
      return c.json({ code: 400, message: '广告曝光参数无效', data: null }, 400);
    }
    if (tokens.length === 0) return c.json({ code: 403, message: '缺少广告曝光令牌', data: null }, 403);
    const ip = getClientIp(c);
    const userAgent = c.req.header('user-agent') ?? null;
    let payloads: CmsAdEventTokenPayload[] = [];
    try {
      payloads = await consumeCmsAdEventTokens(tokens, { eventType: 'impression', ip, userAgent });
      const first = payloads[0];
      if (payloads.some((item) =>
        item.siteId !== first.siteId
        || item.path !== first.path
        || item.memberId !== first.memberId)) {
        throw new HTTPException(403, { message: '广告曝光令牌不属于同一页面' });
      }
      await recordCmsAdImpressions(payloads.map((item) => item.adId), {
        ip,
        userAgent,
        referrer: c.req.header('referer') ?? null,
        path: first.path,
        memberId: first.memberId,
        expectedSiteId: first.siteId,
      });
    } catch (error) {
      await Promise.all(payloads.map(releaseCmsAdEventToken));
      const status = error instanceof HTTPException ? error.status : 500;
      const message = error instanceof HTTPException ? error.message : '广告曝光记录失败';
      return c.json({ code: status, message, data: null }, status);
    }
    return c.body(null, 204);
  });

  // ─── 浏览计数 beacon（静态页 sendBeacon 上报；同 IP+内容 60s 去重防刷）────────
  app.post('/view', async (c) => {
    let contentId: number;
    try {
      const body = await c.req.json<{ contentId?: number }>();
      contentId = Number(body?.contentId) || 0;
    } catch {
      return c.body(null, 204);
    }
    if (!contentId) return c.body(null, 204);
    const ip = getClientIp(c);
    const dedupeKey = `${config.redis.keyPrefix}cms:view:${contentId}:${hashCmsIp(ip)}`;
    const first = await redis.set(dedupeKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
    if (first) {
      await increaseViewCount(contentId).catch(() => undefined);
    }
    return c.body(null, 204);
  });

  return app;
}
