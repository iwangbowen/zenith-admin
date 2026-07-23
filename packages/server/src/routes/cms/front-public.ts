import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { submitCmsCommentSchema, voteCmsPollSchema } from '@zenith/shared';
import { resolveSiteByCode } from '../../services/cms/cms-sites.service';
import { getCmsCommentSite, submitCmsComment, likeCmsComment, throttleFrontSubmit } from '../../services/cms/cms-comments.service';
import { getCmsFormByCode, submitCmsForm } from '../../services/cms/cms-forms.service';
import { getPublishedSurveyByCode, submitCmsSurvey } from '../../services/cms/cms-surveys.service';
import { increaseViewCount } from '../../services/cms/cms-contents.service';
import { recordAdClick } from '../../services/cms/cms-ads.service';
import { recordAdViews, recordAdClickStat } from '../../services/cms/cms-stats.service';
import { generateCmsCaptcha, verifyCmsCaptcha, isCaptchaEnabled } from '../../services/cms/cms-captcha.service';
import {
  getPublishedPollByCode, getCmsPollResults, voteCmsPoll, hasVotedCmsPoll, isPollOpen, mapCmsPoll,
} from '../../services/cms/cms-polls.service';
import { config } from '../../config';
import redis from '../../lib/redis';
import { readCmsThemeAsset, readCmsThemePreviewAsset } from '../../services/cms/cms-themes.service';

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

function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  return forwarded?.split(',')[0].trim() || headers.get('x-real-ip') || 'unknown';
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
    const ip = clientIp(c.req.raw.headers);
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
        ip: clientIp(c.req.raw.headers),
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
        ip: clientIp(c.req.raw.headers),
        userAgent: c.req.header('user-agent')?.slice(0, 255) ?? null,
      });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
      const status = err instanceof HTTPException ? (err.status as 400 | 429) : 500;
      return respond('提交失败', msg, status);
    }
    return respond('提交成功', form.successMessage?.trim() || '我们已收到您的信息。');
  });

  // ─── 问卷匿名提交（原生 form POST；字段名 q_{题目id}，多选同名多值）────────────
  app.post('/surveys/:siteCode/:code', async (c) => {
    const body = await c.req.parseBody({ all: true });
    const backUrl = safeReturnUrl(body.returnUrl);
    const respond = (title: string, text: string, status: 200 | 400 | 401 | 404 | 429 | 500 = 200) =>
      c.newResponse(messagePage(title, text, backUrl), status, { 'Content-Type': 'text/html; charset=utf-8' });

    if (typeof body.website === 'string' && body.website) {
      return respond('提交失败', '提交被拒绝', 400);
    }
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return respond('提交失败', '站点不存在', 404);
    const survey = await getPublishedSurveyByCode(site.id, c.req.param('code'));
    if (!survey) return respond('提交失败', '问卷不存在或未开放', 404);
    const answers: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!key.startsWith('q_')) continue;
      const qid = key.slice(2);
      if (Array.isArray(value)) {
        answers[qid] = value.filter((v): v is string => typeof v === 'string');
      } else if (typeof value === 'string') {
        answers[qid] = value;
      }
    }
    try {
      await submitCmsSurvey(survey, { answers }, { memberId: null, ip: clientIp(c.req.raw.headers) });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '提交失败，请稍后再试';
      const status = err instanceof HTTPException ? (err.status as 400 | 401 | 429) : 500;
      return respond('提交失败', msg, status);
    }
    return respond('提交成功', '感谢您的参与！');
  });

  // ─── 评论点赞（同 IP 对同评论 24h 去重；原生 form POST，处理后跳回来源页）─────
  app.post('/comments/:id/like', async (c) => {
    const body = await c.req.parseBody();
    const backUrl = safeReturnUrl(body.returnUrl);
    const commentId = Number(c.req.param('id')) || 0;
    if (commentId > 0) {
      const ip = clientIp(c.req.raw.headers);
      await throttleFrontSubmit(ip).catch(() => undefined);
      await likeCmsComment(commentId, ip).catch(() => undefined);
    }
    return c.redirect(backUrl, 302);
  });

  // ─── 投票：查询（含实时计票与我的投票状态）────────────────────────────────────
  app.get('/polls/:siteCode/:code', async (c) => {
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return c.json({ code: 404, message: '站点不存在', data: null }, 404);
    const poll = await getPublishedPollByCode(site.id, c.req.param('code'));
    if (!poll || poll.status === 'draft') return c.json({ code: 404, message: '投票不存在', data: null }, 404);
    const ip = clientIp(c.req.raw.headers);
    const [results, voted] = await Promise.all([
      getCmsPollResults(poll),
      hasVotedCmsPoll(poll.id, { memberId: null, ip }),
    ]);
    return c.json({
      code: 0, message: 'ok',
      data: { poll: mapCmsPoll(poll), results, voted, open: isPollOpen(poll) },
    });
  });

  // ─── 投票：游客提交（同 IP 一票；JSON POST）───────────────────────────────────
  app.post('/polls/:siteCode/:code/vote', async (c) => {
    const site = await resolveSiteByCode(c.req.param('siteCode'));
    if (!site) return c.json({ code: 404, message: '站点不存在', data: null }, 404);
    const poll = await getPublishedPollByCode(site.id, c.req.param('code'));
    if (!poll || poll.status === 'draft') return c.json({ code: 404, message: '投票不存在', data: null }, 404);
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ code: 400, message: '提交参数有误', data: null }, 400);
    }
    const parsed = voteCmsPollSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ code: 400, message: parsed.error.issues[0]?.message ?? '提交参数有误', data: null }, 400);
    }
    const ip = clientIp(c.req.raw.headers);
    try {
      await throttleFrontSubmit(ip);
      const results = await voteCmsPoll(poll, parsed.data.optionIds, { memberId: null, ip });
      return c.json({ code: 0, message: '投票成功', data: results });
    } catch (err) {
      const msg = err instanceof HTTPException ? err.message : '投票失败，请稍后再试';
      const status = err instanceof HTTPException ? err.status : 500;
      return c.json({ code: status, message: msg, data: null }, status);
    }
  });

  // ─── 广告点击中转（计数 +1 后 302 跳目标地址；静态页零 JS 可用）───────────────
  app.get('/ads/:id/click', async (c) => {
    const adId = Number(c.req.param('id')) || 0;
    const linkUrl = adId > 0 ? await recordAdClick(adId).catch(() => null) : null;
    if (!linkUrl) return c.text('广告不存在或未投放', 404);
    recordAdClickStat(adId);
    return c.redirect(linkUrl, 302);
  });

  // ─── 广告曝光 beacon（页面加载时批量上报本页广告 id；同 IP 60s 去重防刷）───────
  app.post('/ads/view', async (c) => {
    let ids: number[];
    try {
      const body = await c.req.json<{ ids?: number[] }>();
      ids = Array.isArray(body?.ids) ? body.ids : [];
    } catch {
      return c.body(null, 204);
    }
    if (ids.length === 0) return c.body(null, 204);
    const ip = clientIp(c.req.raw.headers);
    const dedupeKey = `${config.redis.keyPrefix}cms:adview:${ip}:${[...new Set(ids)].sort((a, b) => a - b).join(',')}`;
    const first = await redis.set(dedupeKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
    if (first) {
      await recordAdViews(ids).catch(() => undefined);
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
    const ip = clientIp(c.req.raw.headers);
    const dedupeKey = `${config.redis.keyPrefix}cms:view:${contentId}:${ip}`;
    const first = await redis.set(dedupeKey, '1', 'EX', 60, 'NX').catch(() => 'OK');
    if (first) {
      await increaseViewCount(contentId).catch(() => undefined);
    }
    return c.body(null, 204);
  });

  return app;
}
