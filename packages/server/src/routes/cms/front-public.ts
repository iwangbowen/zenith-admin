import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { submitCmsCommentSchema, submitCmsInteractionSchema } from '@zenith/shared';
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
import { readCmsThemeAsset, readCmsThemePreviewAsset } from '../../services/cms/cms-themes.service';
import { optionalMemberSessionMiddleware } from '../../middleware/optional-member-session';
import { getClientIp } from '../../lib/request-helpers';
import { hashCmsIp } from '../../services/cms/cms-visitor';

/**
 * CMS 前台公开提交接口（评论 / 自定义表单）。
 * 面向静态页的原生 HTML form POST（零 JS），处理后返回轻量提示页并跳回来源页。
 * 防护：Redis IP 限流 + 蜜罐字段 + 敏感词过滤（service 层）。
 */

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** 轻量提示页：2 秒后 meta refresh 跳回来源页 */
function messagePage(title: string, text: string, backUrl: string): string {
  const safeBack = escapeHtml(backUrl);
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="2;url=${safeBack}"><title>${escapeHtml(title)}</title><style>body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f6f8fa}main{text-align:center;padding:40px;background:#fff;border:1px solid #d1d9e0;border-radius:10px}h1{font-size:20px;margin:0 0 8px}p{color:#59636e;font-size:14px;margin:0 0 16px}a{color:#1f6feb}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><a href="${safeBack}">立即返回</a></main></body></html>`;
}

/** 提取安全回跳地址：仅允许站内相对路径，防开放重定向 */
function safeReturnUrl(raw: unknown): string {
  const url = typeof raw === 'string' ? raw : '';
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return '/';
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

export function createCmsFrontPublicRoutes(): Hono {
  const app = new Hono();
  app.use('*', optionalMemberSessionMiddleware);
  const assetPath = (requestPath: string) => {
    const marker = '/assets/';
    const index = requestPath.indexOf(marker);
    return index >= 0 ? requestPath.slice(index + marker.length) : '';
  };

  app.get('/theme-assets/:siteId/:code/:version/assets/*', async (c) => {
    const result = await readCmsThemeAsset(
      Number(c.req.param('siteId')),
      c.req.param('code'),
      c.req.param('version'),
      assetPath(c.req.path),
    );
    return new Response(result.content, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'",
      },
    });
  });

  app.get('/theme-preview-assets/:siteId/:packageId/:expiresAt/:token/assets/*', async (c) => {
    const result = await readCmsThemePreviewAsset(
      Number(c.req.param('siteId')),
      Number(c.req.param('packageId')),
      Number(c.req.param('expiresAt')),
      c.req.param('token'),
      assetPath(c.req.path),
    );
    return new Response(result.content, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'",
      },
    });
  });

  // ─── 图形验证码（站点开启 captchaEnabled 时评论/表单提交必须携带）──────────────
  app.get('/captcha', async (c) => {
    const ip = getClientIp(c);
    await throttleFrontSubmit(ip).catch(() => undefined);
    const challenge = await generateCmsCaptcha();
    return c.json({ code: 0, message: 'ok', data: challenge });
  });

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

  // ─── Stage 4 统一互动问卷：查询与结果可见性 ─────────────────────────────────
  app.get('/interactions/:siteCode/:code', async (c) => {
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return c.json({ code: 404, message: '站点不存在', data: null }, 404);
    const interaction = await getPublicCmsInteractionByCode(site.id, c.req.param('code'));
    if (!interaction) return c.json({ code: 404, message: '互动问卷不存在', data: null }, 404);
    const state = await getCmsInteractionPublicState(interaction, {
      memberId: c.get('member')?.memberId ?? null,
      ip: getClientIp(c),
    });
    return c.json({ code: 0, message: 'ok', data: state });
  });

  // ─── Stage 4 统一互动问卷：公开/可选会员提交 ─────────────────────────────────
  app.post('/interactions/:siteCode/:code/submit', async (c) => {
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return c.json({ code: 404, message: '站点不存在', data: null }, 404);
    const interaction = await getPublicCmsInteractionByCode(site.id, c.req.param('code'));
    if (!interaction) return c.json({ code: 404, message: '互动问卷不存在', data: null }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ code: 400, message: '提交参数有误', data: null }, 400);
    }
    const parsed = submitCmsInteractionSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ code: 400, message: parsed.error.issues[0]?.message ?? '提交参数有误', data: null }, 400);
    }
    const ip = getClientIp(c);
    try {
      await throttleFrontSubmit(ip);
      const result = await submitCmsInteraction(interaction, parsed.data, {
        memberId: c.get('member')?.memberId ?? null,
        ip,
        userAgent: c.req.header('user-agent') ?? null,
        idempotencyKey: c.req.header('x-idempotency-key') ?? null,
      });
      return c.json({ code: 0, message: result.message, data: result });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
      const status = err instanceof HTTPException ? err.status : 500;
      return c.json({ code: status, message: msg, data: null }, status);
    }
  });

  // ─── 广告事件令牌：短期、一次性并绑定站点/广告/页面/访客 ───────────────────
  app.post('/ads/tokens/:siteCode', async (c) => {
    c.header('Cache-Control', 'no-store');
    let body: {
      ads?: Array<{ adId?: number; renderProof?: string }>;
      channelCode?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ code: 400, message: '广告事件令牌参数无效', data: null }, 400);
    }
    const ip = getClientIp(c);
    try {
      await throttleCmsAdTokenIssue(ip);
      const tokens = await issueCmsAdEventTokens({
        siteCode: c.req.param('siteCode'),
        ads: Array.isArray(body.ads)
          ? body.ads.map((item) => ({
            adId: Number(item.adId),
            renderProof: typeof item.renderProof === 'string' ? item.renderProof : '',
          }))
          : [],
        channelCode: typeof body.channelCode === 'string' ? body.channelCode.slice(0, 50) : null,
        host: c.req.header('host') ?? null,
        memberId: c.get('member')?.memberId ?? null,
        ip,
        userAgent: c.req.header('user-agent') ?? null,
      });
      return c.json({ code: 0, message: 'ok', data: tokens });
    } catch (error) {
      const status = error instanceof HTTPException ? error.status : 500;
      const message = error instanceof HTTPException ? error.message : '广告事件令牌签发失败';
      return c.json({ code: status, message, data: null }, status);
    }
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
        publishChannelId: payload.publishChannelId,
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
    const payloads: CmsAdEventTokenPayload[] = [];
    try {
      for (const token of tokens) {
        payloads.push(await consumeCmsAdEventToken(token, { eventType: 'impression', ip, userAgent }));
      }
      const first = payloads[0];
      if (payloads.some((item) =>
        item.siteId !== first.siteId
        || item.path !== first.path
        || item.publishChannelId !== first.publishChannelId
        || item.memberId !== first.memberId)) {
        throw new HTTPException(403, { message: '广告曝光令牌不属于同一页面' });
      }
      await recordCmsAdImpressions(payloads.map((item) => item.adId), {
        ip,
        userAgent,
        referrer: c.req.header('referer') ?? null,
        path: first.path,
        publishChannelId: first.publishChannelId,
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
