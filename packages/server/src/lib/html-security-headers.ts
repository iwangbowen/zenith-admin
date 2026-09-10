/**
 * 服务端直出 HTML（CMS 前台 SSR / 静态化产物 / 前台表单提示页）的安全响应头。
 *
 * CMS 前台交互由外链岛脚本（/_assets/islands.{hash}.js，'self' 放行）承担，主题里仅保留极少量
 * 内容恒定的内联脚本（暗色初始化、会员受众重载）；正文里的用户 HTML 已由 sanitizeCmsHtml 剔除脚本。
 * 因此可以按响应实际包含的可执行内联 <script> 计算 sha256 哈希放行，不使用 'unsafe-inline'——
 * 即便净化被绕过，注入的脚本 / 事件属性 / javascript: 也不会执行。
 * JSON-LD 等数据块（type 非 JavaScript）浏览器不会执行，不参与哈希，CSP 头因而在同站各页面间恒定，
 * 可随页面一起进入 CDN / 浏览器缓存。静态化文件同样在出站时计算，哈希天然一致。
 */
import { createHash } from 'node:crypto';
import { createMiddleware } from 'hono/factory';

/** 第三方验证码（Cloudflare Turnstile）需要的外部来源 */
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

const INLINE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const SCRIPT_TYPE_RE = /\stype\s*=\s*["']?\s*([^"'\s>]+)/i;
/** 浏览器视为可执行的 type：缺省、JavaScript MIME、module（其余如 application/ld+json、text/template 为数据块） */
const EXECUTABLE_SCRIPT_TYPES = new Set(['module', 'text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript', 'text/jscript']);

function isExecutableScript(attrs: string): boolean {
  const match = SCRIPT_TYPE_RE.exec(` ${attrs}`);
  if (!match) return true;
  return EXECUTABLE_SCRIPT_TYPES.has(match[1].toLowerCase());
}

/** 收集 HTML 中所有无 src 且可执行的内联脚本哈希（'sha256-…' 形式，去重） */
export function collectInlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const attrs = match[1] ?? '';
    if (/\ssrc\s*=/i.test(` ${attrs}`)) continue;
    if (!isExecutableScript(attrs)) continue;
    const body = match[2] ?? '';
    if (!body) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes];
}

export interface HtmlCspOptions {
  /** 允许被哪些 origin 嵌入；默认仅同源 */
  frameAncestors?: string;
}

/** 按 HTML 内容生成 CSP：内联脚本哈希放行，样式允许内联（主题大量使用 style 属性），媒体 / 图片允许外链 */
export function buildHtmlCsp(html: string, options: HtmlCspOptions = {}): string {
  const scriptSources = ["'self'", ...collectInlineScriptHashes(html), TURNSTILE_ORIGIN];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' data: blob: https: http:",
    "font-src 'self' data: https:",
    `connect-src 'self' ${TURNSTILE_ORIGIN}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${options.frameAncestors ?? "'self'"}`,
  ].join('; ');
}

/** 直出 HTML 响应应附带的安全头 */
export function htmlSecurityHeaders(html: string, options: HtmlCspOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': buildHtmlCsp(html, options),
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/** 载入第三方 UI（CDN 脚本）的文档页，不适用哈希白名单 CSP */
const CSP_EXEMPT_PATHS = new Set(['/api/docs']);

/**
 * 全局中间件：凡是 text/html 且尚未自带 CSP 的响应，按正文内联脚本哈希补齐 CSP 与帧保护头。
 * 覆盖 CMS 前台 SSR / 静态化产物、前台表单提示页、短链提示页、退订页等所有服务端直出 HTML，
 * 后续新增的 c.html() 路由无需各自处理。响应体需读取一次，仅对 HTML 生效，JSON / 文件流不受影响。
 */
export const htmlSecurityHeadersMiddleware = createMiddleware(async (c, next) => {
  await next();
  const res = c.res;
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/html')) return;
  if (res.headers.has('content-security-policy') || CSP_EXEMPT_PATHS.has(c.req.path)) return;
  if (!res.body || res.status === 304) return;
  // 已压缩 / 分块编码的响应不能按文本重建（正常链路不会出现：本中间件位于 compress 内侧）
  if (res.headers.has('content-encoding')) return;
  const html = await res.text();
  const headers = new Headers(res.headers);
  // 正文重建后由运行时重新计算长度；已被上游压缩的响应不会到这里（本中间件位于 compress 内侧）
  headers.delete('content-length');
  for (const [key, value] of Object.entries(htmlSecurityHeaders(html))) headers.set(key, value);
  c.res = new Response(html, { status: res.status, statusText: res.statusText, headers });
});
