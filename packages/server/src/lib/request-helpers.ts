import type { Context } from 'hono';
import { UAParser } from 'ua-parser-js';

/**
 * 从请求头中提取客户端真实 IP。
 * 优先信任反向代理的 x-forwarded-for 头，其次 x-real-ip，最后回退到 127.0.0.1。
 */
export function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    '127.0.0.1'
  );
}

/**
 * 解析 User-Agent 字符串，返回浏览器和操作系统信息。
 */
export function parseUserAgent(ua: string): { browser: string; os: string } {
  const parser = new UAParser(ua);
  const b = parser.getBrowser();
  const o = parser.getOS();
  return {
    browser: b.name ? `${b.name} ${b.version ?? ''}`.trim() : 'Unknown',
    os: o.name ? `${o.name} ${o.version ?? ''}`.trim() : 'Unknown',
  };
}
