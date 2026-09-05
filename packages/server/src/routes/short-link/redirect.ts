/**
 * 短链公开跳转（无需登录）。
 *
 * 非 OpenAPI 路由：输出为 30x 跳转或轻量 HTML 提示页，不进入 API 文档。
 * 限流复用 pathBoundRateLimit —— 平台「限流规则」中配置 pathPatterns ['/s/*'] 即可生效。
 */
import { Hono } from 'hono';
import { pathBoundRateLimit } from '../../middleware/rate-limit';
import { getClientInfo } from '../../lib/request-helpers';
import { escapeHtml } from '@zenith/shared/core';
import {
  resolveShortLink,
  getLiveVisitCount,
  recordShortLinkClickSafe,
} from '../../services/short-link/short-link-redirect.service';

const CODE_PATTERN = /^[0-9A-Za-z_-]{1,32}$/;

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f5f7;color:#1f2329;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);padding:40px 36px;max-width:400px;width:calc(100% - 48px);text-align:center}
  h1{font-size:18px;margin:0 0 12px}
  p{font-size:14px;color:#646a73;margin:0 0 20px;line-height:1.6}
  input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:14px;border:1px solid #d0d3d6;border-radius:8px;outline:none}
  input:focus{border-color:#3370ff}
  button{margin-top:14px;width:100%;padding:10px 0;font-size:14px;border:0;border-radius:8px;background:#3370ff;color:#fff;cursor:pointer}
  button:hover{background:#2b5fd9}
  .err{color:#d83931;font-size:13px;margin-top:10px}
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

function noticePage(title: string, message: string): string {
  return pageShell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`);
}

function passwordPage(code: string, hasError: boolean): string {
  return pageShell('访问验证', `
<h1>此链接需要访问密码</h1>
<p>请输入分享者提供的访问密码</p>
<form method="get" action="/s/${escapeHtml(code)}">
  <input type="password" name="pwd" placeholder="访问密码" autofocus autocomplete="off" maxlength="32">
  ${hasError ? '<div class="err">密码不正确，请重试</div>' : ''}
  <button type="submit">访问</button>
</form>`);
}

const redirectRouter = new Hono();

redirectRouter.use('*', pathBoundRateLimit);

redirectRouter.get('/:code', async (c) => {
  const code = c.req.param('code');
  if (!CODE_PATTERN.test(code)) {
    return c.html(noticePage('链接不存在', '您访问的短链接不存在或已被删除。'), 404);
  }

  const link = await resolveShortLink(code);
  if (!link || link.status !== 'enabled') {
    return c.html(noticePage('链接不存在', '您访问的短链接不存在或已停用。'), 404);
  }
  if (link.expiresAtMs !== null && link.expiresAtMs <= Date.now()) {
    return c.html(noticePage('链接已过期', '该短链接已超过有效期，请联系分享者获取新链接。'), 410);
  }
  if (link.maxVisits !== null) {
    const visits = await getLiveVisitCount(link.id);
    if (visits >= link.maxVisits) {
      return c.html(noticePage('链接已失效', '该短链接的访问次数已达上限。'), 410);
    }
  }
  if (link.password) {
    const pwd = c.req.query('pwd');
    if (!pwd) return c.html(passwordPage(code, false), 200);
    if (pwd !== link.password) return c.html(passwordPage(code, true), 200);
  }

  const { ip, ua } = getClientInfo(c);
  recordShortLinkClickSafe({ link, ip, ua, referer: c.req.header('referer') ?? null });

  if (link.redirectType === '301') {
    return c.redirect(link.finalUrl, 301);
  }
  // 302 显式禁止缓存，保证「改址即生效」与点击统计不被浏览器缓存吞掉
  c.header('Cache-Control', 'no-store');
  return c.redirect(link.finalUrl, 302);
});

export default redirectRouter;
