import { BlockList, isIPv4, isIPv6 } from 'node:net';

/** 去掉 IPv6 映射前缀（::ffff:1.2.3.4）与作用域后缀（fe80::1%eth0） */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped) return mapped[1];
  return trimmed.split('%')[0];
}

function addRule(list: BlockList, rule: string): void {
  const [address, prefix] = rule.trim().split('/');
  const ip = normalizeIp(address);
  const family = isIPv4(ip) ? 'ipv4' : isIPv6(ip) ? 'ipv6' : null;
  if (!family) return;
  if (prefix === undefined) list.addAddress(ip, family);
  else list.addSubnet(ip, Number(prefix), family);
}

/**
 * IP 是否命中白名单（单地址或 CIDR；IPv4 / IPv6）。
 * 空白名单视为不限制；非法规则条目被忽略，非法客户端 IP 视为不命中。
 */
export function ipInAllowlist(clientIp: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const ip = normalizeIp(clientIp);
  if (!isIPv4(ip) && !isIPv6(ip)) return false;
  const list = new BlockList();
  for (const rule of allowlist) {
    try {
      addRule(list, rule);
    } catch {
      // 规则在契约层已校验；此处防御历史脏数据
    }
  }
  return list.check(ip, isIPv4(ip) ? 'ipv4' : 'ipv6');
}
