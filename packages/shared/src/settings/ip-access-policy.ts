import ipaddr from 'ipaddr.js';
import type { IpAccessSettings } from './modules/ip-access';

/** Reject legacy IPv4 shorthand, octal, zones and ambiguous mapped prefixes. */
function parseRange(value: string) {
  const parts = value.trim().split('/');
  if (parts.length > 2 || !parts[0] || parts[0].includes('%')) return null;
  const raw = parts[0];
  const dotted = raw.includes('.') ? raw.slice(raw.lastIndexOf(':') + 1) : null;
  if (dotted && !/^(?:(?:0|[1-9]\d{0,2})\.){3}(?:0|[1-9]\d{0,2})$/.test(dotted)) return null;
  if (!raw.includes(':') && !dotted) return null;
  try {
    let address = ipaddr.parse(raw);
    let prefix = address.kind() === 'ipv4' ? 32 : 128;
    if (parts.length === 2) {
      if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[1])) return null;
      prefix = Number(parts[1]);
      if (prefix > (address.kind() === 'ipv4' ? 32 : 128)) return null;
    }
    if (address instanceof ipaddr.IPv6 && address.isIPv4MappedAddress()) {
      if (prefix < 96) return null;
      address = address.toIPv4Address();
      prefix -= 96;
    }
    const bytes = address.toByteArray().map((byte, index) => {
      const bits = Math.max(0, Math.min(8, prefix - index * 8));
      return byte & (bits === 0 ? 0 : 256 - 2 ** (8 - bits));
    });
    return { address: ipaddr.fromByteArray(bytes), prefix, cidr: parts.length === 2 };
  } catch { return null; }
}

export function normalizeIpOrCidr(value: string): string | null {
  const range = parseRange(value);
  return range ? `${range.address.toString()}${range.cidr ? '/' + range.prefix : ''}` : null;
}

export function isIpOrCidr(value: string): boolean {
  return normalizeIpOrCidr(value) !== null;
}

export function matchesIpRange(ip: string, range: string): boolean {
  if (ip.includes('/')) return false;
  const source = parseRange(ip);
  const target = parseRange(range);
  return !!source && !!target && source.address.kind() === target.address.kind()
    && source.address.match(target.address, target.prefix);
}

export function ipRangesOverlap(left: string, right: string): boolean {
  const a = parseRange(left);
  const b = parseRange(right);
  return !!a && !!b && a.address.kind() === b.address.kind()
    && a.address.match(b.address, Math.min(a.prefix, b.prefix));
}

/** Shared by enforcement, draft diagnosis and every settings write/restore. */
export function evaluateIpAccess(policy: IpAccessSettings, ip: string) {
  const normalizedIp = !ip.includes('/') ? normalizeIpOrCidr(ip) : null;
  if (!policy.blacklistEnabled && !policy.whitelistEnabled) return { allowed: true, reason: 'disabled' as const, matchedEntry: null };
  if (!normalizedIp) return { allowed: false, reason: 'invalid-ip' as const, matchedEntry: null };
  const denied = policy.blacklistEnabled ? policy.blacklist.find((entry) => matchesIpRange(normalizedIp, entry)) : undefined;
  if (denied) return { allowed: false, reason: 'blacklist' as const, matchedEntry: denied };
  const allowed = policy.whitelistEnabled ? policy.whitelist.find((entry) => matchesIpRange(normalizedIp, entry)) : undefined;
  if (policy.whitelistEnabled && !allowed) return { allowed: false, reason: 'whitelist' as const, matchedEntry: null };
  return { allowed: true, reason: allowed ? 'whitelist' as const : 'default' as const, matchedEntry: allowed ?? null };
}
