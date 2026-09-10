import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { buildHtmlCsp, collectInlineScriptHashes, htmlSecurityHeadersMiddleware } from './html-security-headers';
import { createHash } from 'node:crypto';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

describe('html-security-headers（M7）', () => {
  it('收集无 src 的可执行内联脚本哈希，忽略外部脚本、空脚本与数据块（JSON-LD 等）', () => {
    const html = '<script>alert(1)</script><script src="/a.js"></script><script type="application/ld+json">{"a":1}</script><script></script>'
      + '<script type="module">m()</script><script type="text/javascript">j()</script><script type="text/template"><p>x</p></script>';
    expect(collectInlineScriptHashes(html)).toEqual([sha('alert(1)'), sha('m()'), sha('j()')]);
  });

  it('CSP 不随 JSON-LD 内容变化：同一套内联脚本的页面得到相同的 script-src', () => {
    const a = buildHtmlCsp('<script type="application/ld+json">{"headline":"A"}</script><script>init()</script>');
    const b = buildHtmlCsp('<script type="application/ld+json">{"headline":"B"}</script><script>init()</script>');
    expect(a).toBe(b);
    expect(a).toContain(`script-src 'self' ${sha('init()')} https://challenges.cloudflare.com`);
  });

  it('CSP 不含 unsafe-inline 脚本，放行 Turnstile，默认仅同源可嵌入', () => {
    const csp = buildHtmlCsp('<script>x()</script>');
    expect(csp).toContain(`script-src 'self' ${sha('x()')} https://challenges.cloudflare.com`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('中间件只给 text/html 响应补 CSP 与帧保护头，JSON 不受影响', async () => {
    const app = new Hono();
    app.use('*', htmlSecurityHeadersMiddleware);
    app.get('/page', (c) => c.html('<html><script>run()</script><body>hi</body></html>'));
    app.get('/json', (c) => c.json({ ok: true }));
    app.get('/custom', (c) => c.newResponse('<p>x</p>', 200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" }));

    const page = await app.request('/page');
    expect(page.headers.get('content-security-policy')).toContain(sha('run()'));
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(await page.text()).toContain('hi');

    const json = await app.request('/json');
    expect(json.headers.get('content-security-policy')).toBeNull();

    const custom = await app.request('/custom');
    expect(custom.headers.get('content-security-policy')).toBe("default-src 'none'");
  });
});
