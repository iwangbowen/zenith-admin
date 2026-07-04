/**
 * 数据分析 / 错误监控 公共工具：
 * - UA 解析（浏览器 / 操作系统 / 设备类型）
 * - IP → 地理位置（基于已内置的 node-ip2region 离线库 + CDN 头兜底）
 * - 错误指纹计算（含租户因子，全局唯一）
 * - Web Vitals 性能评级
 * - 日期区间工具
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { UAParser } from 'ua-parser-js';
import type { AnalyticsDeviceType } from '@zenith/shared';

const require = createRequire(import.meta.url);
const Ip2Region = require('node-ip2region') as {
  create: () => { btreeSearchSync: (ip: string) => { city: number; region: string } | null };
};
let searcher: ReturnType<typeof Ip2Region.create> | null = null;
function getSearcher() {
  searcher ??= Ip2Region.create();
  return searcher;
}

const LOCALHOST_IPS = new Set(['127.0.0.1', '::1', 'localhost']);
function isPrivateIp(ip: string): boolean {
  return (
    LOCALHOST_IPS.has(ip) ||
    ip.startsWith('::ffff:127.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  );
}

export interface ClientGeo {
  country: string | null;
  region: string | null;
  city: string | null;
}

/** 将 IP 解析为结构化地理位置 {country, region, city} */
export function lookupIpGeo(ip: string | null | undefined): ClientGeo {
  const empty: ClientGeo = { country: null, region: null, city: null };
  if (!ip) return empty;
  const cleaned = ip.split(',')[0].trim();
  if (isPrivateIp(cleaned)) return { country: '内网', region: null, city: null };
  try {
    const result = getSearcher().btreeSearchSync(cleaned);
    if (!result?.region) return empty;
    // ip2region 格式：国家|区域|省份|城市|ISP
    const parts = result.region.split('|').map((p) => (p === '0' ? '' : p));
    return {
      country: parts[0] || null,
      region: parts[2] || null,
      city: parts[3] || null,
    };
  } catch {
    return empty;
  }
}

export interface ClientEnv {
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  osVersion: string | null;
  deviceType: AnalyticsDeviceType;
}

function normalizeDeviceType(raw: string | undefined, ua: string): AnalyticsDeviceType {
  if (raw === 'mobile') return 'mobile';
  if (raw === 'tablet') return 'tablet';
  if (raw === 'wearable' || raw === 'console' || raw === 'smarttv' || raw === 'embedded') return 'mobile';
  if (/bot|crawler|spider|crawling|headless/i.test(ua)) return 'bot';
  if (!ua) return 'unknown';
  return 'desktop';
}

/** 解析 UA 字符串为结构化浏览器/系统/设备信息 */
export function parseClientEnv(ua: string | null | undefined): ClientEnv {
  if (!ua) return { browser: null, browserVersion: null, os: null, osVersion: null, deviceType: 'unknown' };
  const parser = new UAParser(ua);
  const b = parser.getBrowser();
  const o = parser.getOS();
  const d = parser.getDevice();
  const major = b.version ? b.version.split('.')[0] : null;
  return {
    browser: b.name ?? null,
    browserVersion: major,
    os: o.name ?? null,
    osVersion: o.version ?? null,
    deviceType: normalizeDeviceType(d.type, ua),
  };
}

/**
 * 计算错误指纹（含 tenant 因子，使指纹全局唯一，配合 error_groups.fingerprint 唯一索引）。
 * 归一化 message（去掉数字/UUID/十六进制等易变部分）+ 顶层堆栈帧 + 来源文件。
 */
export function computeErrorFingerprint(input: {
  tenantId: number | null;
  errorType: string;
  message: string;
  sourceUrl?: string | null;
  stack?: string | null;
}): string {
  const normalizedMsg = input.message
    .replace(/0x[0-9a-f]+/gi, '0xX')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID')
    .replace(/\d+/g, 'N')
    .slice(0, 300);
  const topFrame = (input.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('at ')) ?? '';
  const normalizedFrame = topFrame.replace(/:\d+:\d+/g, '').replace(/\d+/g, 'N').slice(0, 200);
  const raw = [input.tenantId ?? 'global', input.errorType, normalizedMsg, input.sourceUrl ?? '', normalizedFrame].join('|');
  return createHash('md5').update(raw).digest('hex').slice(0, 32);
}

// ─── Web Vitals 评级 ──────────────────────────────────────────────────────────
const PERF_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  FID: [100, 300],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  load: [2000, 4000],
};

export function perfRating(metricName: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const t = PERF_THRESHOLDS[metricName];
  if (!t) return 'good';
  if (value <= t[0]) return 'good';
  if (value <= t[1]) return 'needs-improvement';
  return 'poor';
}

// ─── 日期工具 ─────────────────────────────────────────────────────────────────
/** 返回 N 天前的 00:00（基于本地时区起点的近似：当前时间往前推 days 天） */
export function startOfDaysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** 限定 days 在 [1, max] 区间 */
export function clampDays(days: unknown, fallback = 30, max = 365): number {
  return Math.min(Math.max(Number(days) || fallback, 1), max);
}

/** 限定 limit 在 [1, max] 区间 */
export function clampLimit(limit: unknown, fallback = 20, max = 100): number {
  return Math.min(Math.max(Number(limit) || fallback, 1), max);
}

// ─── IP 匿名化 ────────────────────────────────────────────────────────────────
/** IPv4 抹掉末段（/24），IPv6 保留前 3 组；解析失败返回 'anonymized'。 */
export function anonymizeIpAddr(ip: string): string {
  if (!ip) return ip;
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  if (ip.includes(':')) {
    const groups = ip.split(':');
    if (groups.length >= 3) return `${groups.slice(0, 3).join(':')}::`;
  }
  return 'anonymized';
}
