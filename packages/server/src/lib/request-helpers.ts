import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { UAParser } from 'ua-parser-js';

/**
 * 从请求头中提取客户端真实 IP。
 * 优先信任反向代理的 x-forwarded-for / x-real-ip 头；
 * 无反代时（本地直连）通过 getConnInfo 取 TCP 层真实连接 IP，不可被客户端伪造。
 */
export function getClientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ??
    c.req.header('x-real-ip') ??
    getConnInfo(c).remote.address ??
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
