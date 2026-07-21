import { isIP } from 'node:net';

export const CMS_CDN_HTTP_SAFETY_OPTIONS = {
  ssrfProtection: true,
  redirect: 'error',
} as const;

export function cmsCdnPurgeHostAllowlist(): string[] {
  return (process.env.CMS_CDN_PURGE_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function matchesHostAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return host.endsWith(suffix) && host !== suffix.slice(1);
    }
    return host === entry;
  });
}

export function validateCdnPurgeEndpoint(rawUrl: string, allowlist: readonly string[]): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('CDN purge URL 格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('CDN purge URL 仅支持 HTTP/HTTPS');
  }
  if (url.username || url.password) throw new Error('CDN purge URL 禁止携带用户名或密码');
  for (const key of url.searchParams.keys()) {
    if (/(?:secret|token|password|signature|authorization|api[_-]?key)/i.test(key)) {
      throw new Error('CDN purge URL 禁止在查询参数中携带凭证，请使用独立鉴权令牌字段');
    }
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    isIP(hostname) !== 0
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname === 'metadata.google.internal'
    || hostname === 'instance-data.ec2.internal'
  ) {
    throw new Error('CDN purge URL 必须使用允许的公网域名');
  }
  if (allowlist.length === 0 || !matchesHostAllowlist(hostname, allowlist)) {
    throw new Error('CDN purge URL 域名不在 CMS_CDN_PURGE_HOST_ALLOWLIST 中');
  }
  return url;
}
