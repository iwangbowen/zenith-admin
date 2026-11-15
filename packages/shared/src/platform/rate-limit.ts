import type { RateLimitAlgorithm, RateLimitKeyType, RateLimitMode } from './constants';
export const RATE_LIMIT_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export const RATE_LIMIT_FAIL_MODES = ['open', 'closed'] as const;
export const RATE_LIMIT_DECISIONS = ['allowed', 'blocked', 'monitored', 'banned', 'exempt', 'degraded'] as const;
export const RATE_LIMIT_DECISION_LABELS: Record<(typeof RATE_LIMIT_DECISIONS)[number], string> = {
  allowed: '放行',
  blocked: '超限拦截',
  monitored: '观察命中',
  banned: '临时封禁',
  exempt: '豁免',
  degraded: '故障放行',
};
export interface RateLimitWindow {
  windowMs: number;
  limit: number;
}
export interface RateLimitOptions {
  methods?: string[];
  extraWindows?: RateLimitWindow[];
  failMode?: 'open' | 'closed';
  alertUserIds?: number[];
  alertCooldownSeconds?: number;
}
export interface RateLimitMatchPolicy {
  name: string;
  keyType: RateLimitKeyType;
  enabled: boolean;
  pathPatterns: readonly string[];
  priority: number;
  methods?: readonly string[];
  mode?: RateLimitMode;
  algorithm?: RateLimitAlgorithm;
}
export function rateLimitPathMatches(pattern: string, path: string): boolean {
  const suffix = pattern.endsWith('/*');
  const core = suffix ? pattern.slice(0, -2) : pattern;
  const source = core
    .split('/')
    .map((segment) => {
      if (segment === '*' || (segment.startsWith('{') && segment.endsWith('}')) || segment.startsWith(':'))
        return '[^/]+';
      return Array.from(segment)
        .map((char) =>
          ('.*+?^$()|[]{}' + String.fromCharCode(92)).includes(char) ? String.fromCharCode(92) + char : char,
        )
        .join('');
    })
    .join('/');
  return new RegExp('^' + source + (suffix ? '(?:/.*)?' : '') + '$').test(path);
}
export function rateLimitMatches(rule: RateLimitMatchPolicy, method: string, path: string): boolean {
  return (
    rule.pathPatterns.some((pattern) => rateLimitPathMatches(pattern, path)) &&
    (!rule.methods?.length || rule.methods.includes(method.toUpperCase()))
  );
}
export function selectRateLimitRule<T extends RateLimitMatchPolicy>(
  rules: readonly T[],
  method: string,
  path: string,
  identityStage: boolean,
): T | undefined {
  return rules
    .filter(
      (rule) => rule.enabled && (rule.keyType === 'user') === identityStage && rateLimitMatches(rule, method, path),
    )
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))[0];
}
export function rateLimitSummary(rule: {
  windowMs: number;
  limit: number;
  extraWindows?: readonly RateLimitWindow[];
}): string {
  return [{ windowMs: rule.windowMs, limit: rule.limit }, ...(rule.extraWindows ?? [])]
    .map((w) => (w.windowMs >= 60000 ? w.windowMs / 60000 + '分钟' : w.windowMs / 1000 + '秒') + ' / ' + w.limit + '次')
    .join('；');
}
