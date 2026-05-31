/**
 * IP 地理位置解析工具（基于 ip2region 本地库）
 * 格式："省份 城市 ISP"，localhost 返回 "内网地址"
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const Ip2Region = require('node-ip2region') as {
  create: () => { btreeSearchSync: (ip: string) => { city: number; region: string } | null };
};

let searcher: ReturnType<typeof Ip2Region.create> | null = null;

function getSearcher() {
  searcher ??= Ip2Region.create();
  return searcher;
}

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * 将 IP 地址解析为可读地理位置字符串。
 * @returns 如 "广东省 深圳市 联通"，解析失败返回 null
 */
export function lookupIpLocation(ip: string): string | null {
  if (!ip) return null;
  const cleaned = ip.split(',')[0].trim(); // 取 x-forwarded-for 第一个 IP
  if (LOCALHOST_IPS.has(cleaned) || cleaned.startsWith('::ffff:127.') || cleaned.startsWith('192.168.') || cleaned.startsWith('10.') || cleaned.startsWith('172.')) {
    return '内网地址';
  }
  try {
    const result = getSearcher().btreeSearchSync(cleaned);
    if (!result?.region) return null;
    // 格式：国家|区域|省份|城市|ISP
    const parts = result.region.split('|');
    const country = parts[0] === '0' ? '' : parts[0];
    const province = parts[2] === '0' ? '' : parts[2];
    const city = parts[3] === '0' ? '' : parts[3];
    const isp = parts[4] === '0' ? '' : parts[4];
    // 国内 IP：省市ISP；境外 IP：国家
    if (country === '中国') {
      return [province, city, isp].filter(Boolean).join(' ') || '中国';
    }
    return [country, province, city].filter(Boolean).join(' ') || null;
  } catch {
    return null;
  }
}
