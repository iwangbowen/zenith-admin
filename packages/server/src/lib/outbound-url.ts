import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import ipRangeCheck from 'ip-range-check';
import { HTTPException } from 'hono/http-exception';

const BLOCKED_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::/96',
  '::1/128',
  '::ffff:0:0/96',
  '64:ff9b::/96',
  '64:ff9b:1::/48',
  'fc00::/7',
  'fe80::/10',
  'fec0::/10',
  'ff00::/8',
  '2001::/32',
  '2001:db8::/32',
  '2002::/16',
];

function normalizedHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

export function isBlockedOutboundIp(ip: string): boolean {
  return isIP(ip) !== 0 && ipRangeCheck(ip, BLOCKED_RANGES);
}

function isAllowlisted(host: string, ip: string | undefined, allowlist: string[]): boolean {
  const normalized = normalizedHost(host);
  return allowlist.some((entry) => {
    const value = entry.trim().toLowerCase();
    if (!value) return false;
    if (value.startsWith('*.')) {
      const suffix = value.slice(1);
      return normalized.endsWith(suffix) && normalized !== suffix.slice(1);
    }
    if (value.includes('/')) return !!ip && ipRangeCheck(ip, value);
    return normalized === normalizedHost(value) || (!!ip && value === ip);
  });
}

export async function assertSafeOutboundHost(
  host: string,
  allowlist: string[] = [],
): Promise<void> {
  await resolveSafeOutboundHost(host, allowlist);
}

export async function resolveSafeOutboundHost(
  host: string,
  allowlist: string[] = [],
): Promise<LookupAddress[]> {
  const normalized = normalizedHost(host);
  if (!normalized) throw new HTTPException(400, { message: '出站地址缺少主机名' });
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    if (!isAllowlisted(normalized, undefined, allowlist)) {
      throw new HTTPException(400, { message: '出站地址不允许访问本机或内网主机' });
    }
  }

  const literalFamily = isIP(normalized);
  const addresses = literalFamily
    ? [{ address: normalized, family: literalFamily }]
    : await lookup(normalized, { all: true, verbatim: true }).catch(() => {
        throw new HTTPException(400, { message: '出站地址 DNS 解析失败' });
      });
  if (!addresses.length) throw new HTTPException(400, { message: '出站地址 DNS 解析失败' });

  for (const { address } of addresses) {
    if (isBlockedOutboundIp(address) && !isAllowlisted(normalized, address, allowlist)) {
      throw new HTTPException(400, { message: '出站地址解析到本机、私网或保留地址，已拒绝访问' });
    }
  }
  return addresses;
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  allowlist: string[] = [],
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HTTPException(400, { message: '出站 URL 格式无效' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HTTPException(400, { message: '出站 URL 仅支持 HTTP/HTTPS' });
  }
  if (url.username || url.password) {
    throw new HTTPException(400, { message: '出站 URL 禁止携带用户名或密码' });
  }
  await assertSafeOutboundHost(url.hostname, allowlist);
  return url;
}

export function createSafeOutboundLookup(
  allowlist: string[] = [],
): LookupFunction {
  return (hostname, options, callback) => {
    void resolveSafeOutboundHost(hostname, allowlist).then((addresses) => {
      const requestedFamily = Number(options.family ?? 0);
      const candidates = requestedFamily
        ? addresses.filter((address) => address.family === requestedFamily)
        : addresses;
      const selected = candidates.length ? candidates : addresses;
      if (options.all) callback(null, selected);
      else callback(null, selected[0].address, selected[0].family);
    }).catch((error: unknown) => {
      callback(error as NodeJS.ErrnoException, '', 0);
    });
  };
}
