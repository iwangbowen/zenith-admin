import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { UAParser } from 'ua-parser-js';
import ipRangeCheck from 'ip-range-check';
import { REPORTED_CLIENT_LABEL_MAX_LENGTH } from '@zenith/shared/core';
import { SESSION_CLIENT_HEADER, SESSION_CLIENT_KINDS, type SessionClientKind } from '@zenith/shared/identity';
import { config } from '../config';

/**
 * 从请求头中提取客户端真实 IP。
 * 优先信任反向代理的 x-forwarded-for / x-real-ip 头；
 * 无反代时（本地直连）通过 getConnInfo 取 TCP 层真实连接 IP，不可被客户端伪造。
 */
export function getClientIp(c: Context): string {
  let remoteAddress = '127.0.0.1';
  try {
    remoteAddress = getConnInfo(c).remote.address ?? remoteAddress;
  } catch {
    // Hono app.request() and non-node adapters do not expose TCP connection metadata.
  }
  const isTrustedProxy = (address: string) => config.trustedProxyCidrs.some((range) => {
    try { return ipRangeCheck(address, range); } catch { return false; }
  });
  if (!isTrustedProxy(remoteAddress)) return remoteAddress;
  const forwarded = c.req.header('x-forwarded-for')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  let clientIp = remoteAddress;
  for (let index = forwarded.length - 1; index >= 0 && isTrustedProxy(clientIp); index--) {
    clientIp = forwarded[index];
  }
  if (clientIp !== remoteAddress) return clientIp;
  return c.req.header('x-real-ip')?.trim() ?? remoteAddress;
}

/**
 * 解析 User-Agent 字符串，返回浏览器和操作系统信息。
 *
 * Win11 的 UA 被浏览器冻结为 `Windows NT 10.0`（与 Win10 不可区分），仅靠 UA
 * 只能判到 Windows 10；Chromium 在 `Accept-CH` 选择后会发送
 * `Sec-CH-UA-Platform-Version`（Win11 起 major ≥ 13），此时可精确到 Windows 11。
 * 自报值（登录请求体 `os`）与审计口径（操作日志）分别见调用方注释。
 */
export function parseUserAgent(ua: string, platformVersion?: string | null): { browser: string; os: string } {
  const parser = new UAParser(ua);
  const b = parser.getBrowser();
  const o = parser.getOS();
  const browser = b.name ? `${b.name} ${b.version ?? ''}`.trim() : 'Unknown';
  let os = o.name ? `${o.name} ${o.version ?? ''}`.trim() : 'Unknown';
  if (isFrozenWindows10(o.name, o.version) && isWindows11ByHints(platformVersion)) os = 'Windows 11';
  return { browser, os };
}

/** ua-parser-js 把 NT 10.0 映射为 Windows/10：Win10 与 Win11 在 UA 里长这样 */
function isFrozenWindows10(name: string | undefined, version: string | undefined): boolean {
  return name === 'Windows' && (version === '10' || version?.startsWith('10.') === true);
}

/** Client Hints 平台版本 major ≥ 13 即 Win11（Chromium 约定）；头值带引号如 `"15.0.0"` */
function isWindows11ByHints(platformVersion: string | null | undefined): boolean {
  if (!platformVersion) return false;
  const major = Number.parseInt(platformVersion.replace(/"/g, '').split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 13;
}

/** 从请求读 Client Hints 平台版本头（无头 / 非 Chromium 返回 null，调用方回退纯 UA 解析） */
export function getPlatformVersion(c: Context): string | null {
  return c.req.header('sec-ch-ua-platform-version') ?? null;
}

/**
 * 自报优先、缺项回退 UA 解析：登录 / 模拟登录 / 操作日志的浏览器·OS 展示值统一走这里。
 * 自报是逐字段的——只报 os 时 browser 仍从 UA 解析（反之亦然），不能因一侧自报把另一侧置 Unknown。
 * 自报值不可信（登录体经契约校验，`X-Zenith-Os` 请求头则完全没有 schema），
 * 这里按 varchar 列宽统一截断兜底：值会进 Redis 会话对象与在线列表，不只是落库列。
 */
export function resolveReportedClient(
  reported: { browser?: string; os?: string },
  ua: string,
  platformVersion?: string | null,
): { browser: string; os: string } {
  const reportedBrowser = clampReportedLabel(reported.browser);
  const reportedOs = clampReportedLabel(reported.os);
  const parsed = reportedBrowser === undefined || reportedOs === undefined
    ? parseUserAgent(ua, platformVersion)
    : null;
  return {
    browser: reportedBrowser ?? parsed?.browser ?? 'Unknown',
    os: reportedOs ?? parsed?.os ?? 'Unknown',
  };
}

/**
 * 自报展示值收紧：去两端空白 → 截断到列宽。
 * 空串 / 纯空白视为未自报（回退解析），避免用空值把展示列清空；超长值直接截断而非报错，
 * 保证审计日志与会话注册不被攻击者构造的超长头搞坏。
 */
function clampReportedLabel(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, REPORTED_CLIENT_LABEL_MAX_LENGTH) : undefined;
}

/**
 * 逐请求展示值：CH 实时解析优先（新鲜且浏览器断言，不可被页面 JS 伪造）；
 * 仅当 UA 冻结在 Win10 歧义时，回退服务端签发的 token OS 断言（登录时写入，随轮换更新）；
 * 断言缺失或为 Unknown 时保持 UA 口径，不降级展示。
 */
export function resolveRequestClient(
  ua: string,
  platformVersion: string | null,
  tokenOs?: string | null,
): { browser: string; os: string } {
  const { browser, os } = parseUserAgent(ua, platformVersion);
  if (os !== 'Windows 10') return { browser, os };
  return { browser, os: tokenOs && tokenOs !== 'Unknown' ? tokenOs : os };
}

const CLIENT_KIND_SET: ReadonlySet<string> = new Set(SESSION_CLIENT_KINDS);

/**
 * 登录终端类型：前端各入口经 `X-Zenith-Client` 自报（网页 / 移动审批 / 桌面端），
 * 只接受枚举内的值，缺省或伪造值一律按 web——它只影响会话展示与「按终端分别计算」的并发分组，不参与鉴权。
 */
export function getClientKind(c: Context): SessionClientKind {
  const raw = c.req.header(SESSION_CLIENT_HEADER)?.trim().toLowerCase();
  return raw && CLIENT_KIND_SET.has(raw) ? (raw as SessionClientKind) : 'web';
}

export interface ClientInfo {
  ip: string;
  ua: string;
  client: SessionClientKind;
}

/**
 * 从请求中提取客户端 IP、User-Agent 与终端类型（登录日志 / 风险事件 / 登录锁定 / 会话审计共用）。
 * IP 复用 getClientIp 的可信代理链判定，直连客户端伪造的 x-forwarded-for / x-real-ip 不生效；
 * 截断到 64 字符防止异常长值溢出各日志表的 ip varchar(64)。
 */
export function getClientInfo(c: Context): ClientInfo {
  return {
    ip: getClientIp(c).slice(0, 64),
    ua: c.req.header('user-agent') ?? '',
    client: getClientKind(c),
  };
}
