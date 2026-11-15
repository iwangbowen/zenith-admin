/** Single source for built-in policies, seed data and management metadata. */
const RULE_BASE = { mode: 'enforce', algorithm: 'fixed_window', allowlist: [] as string[], priority: 0, alertThreshold: null } as const;

import type { RateLimitAlgorithm, RateLimitKeyType, RateLimitMode } from './constants';
export interface BuiltinRateLimitPolicy {
  name: string; description: string | null; windowMs: number; limit: number;
  keyType: RateLimitKeyType; enabled: boolean; mode: RateLimitMode; algorithm: RateLimitAlgorithm;
  allowlist: string[]; priority: number; alertThreshold: number | null; blockedMessage: string | null; pathPatterns: string[];
}
export const DEFAULT_RATE_LIMIT_RULES: Record<string, BuiltinRateLimitPolicy> = {
  auth:      { ...RULE_BASE, name: 'auth',      description: '登录接口限流',          windowMs: 3 * 60 * 1000,      limit: 20, keyType: 'ip', enabled: true, blockedMessage: '登录尝试过于频繁，请 3 分钟后再试', pathPatterns: [] },
  captcha:   { ...RULE_BASE, name: 'captcha',   description: '验证码接口限流',        windowMs: 60 * 1000,          limit: 30, keyType: 'ip', enabled: true, blockedMessage: '验证码请求过于频繁，请稍后再试', pathPatterns: [] },
  sensitive: { ...RULE_BASE, name: 'sensitive', description: '敏感操作（注册/重置）限流', windowMs: 60 * 60 * 1000,  limit: 5,  keyType: 'ip', enabled: true, blockedMessage: '操作过于频繁，请 1 小时后重试', pathPatterns: [] },
  'analytics-ingest': { ...RULE_BASE, name: 'analytics-ingest', description: '匿名埋点事件上报限流', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '埋点上报过于频繁，请稍后再试', pathPatterns: [] },
  'error-report': { ...RULE_BASE, name: 'error-report', description: '匿名前端错误上报限流', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '错误上报过于频繁，请稍后再试', pathPatterns: [] },
  'replay-ingest': { ...RULE_BASE, name: 'replay-ingest', description: '会话回放分片上报限流', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '回放上报过于频繁，请稍后再试', pathPatterns: [] },
  report_public_share: { ...RULE_BASE, name: 'report_public_share', description: '报表公开分享访问限流（无需登录，防滥用/防爆破）', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: ['/api/report/public/*'] },
  workflow_public_callback: { ...RULE_BASE, name: 'workflow_public_callback', description: '工作流公开回调接口限流', windowMs: 60 * 1000, limit: 120, keyType: 'ip_path', enabled: true, blockedMessage: '工作流回调请求过于频繁，请稍后再试', pathPatterns: ['/api/public/workflow/external-callback/*', '/api/public/workflow/trigger-callback/*'] },
  push_public_callback: { ...RULE_BASE, name: 'push_public_callback', description: '推送供应商回执回调限流', windowMs: 60 * 1000, limit: 300, keyType: 'ip', enabled: true, blockedMessage: '回执回调过于频繁，请稍后再试', pathPatterns: ['/api/public/push/callbacks/*'] },
  payment_public_link_pay: { ...RULE_BASE, name: 'payment_public_link_pay', description: '公开支付链接下单限流', windowMs: 60 * 1000, limit: 30, keyType: 'ip_path', enabled: true, blockedMessage: '支付请求过于频繁，请稍后再试', pathPatterns: [] },
  payment_public_link_session: { ...RULE_BASE, name: 'payment_public_link_session', description: '公开支付链接会话查询限流', windowMs: 60 * 1000, limit: 300, keyType: 'ip_path', enabled: true, blockedMessage: '支付状态查询过于频繁，请稍后再试', pathPatterns: [] },
  chat_send: { ...RULE_BASE, name: 'chat_send', description: '聊天消息发送限流（按用户）', windowMs: 60 * 1000, limit: 60, keyType: 'user', enabled: true, blockedMessage: '消息发送过于频繁，请稍后再试', pathPatterns: [] },
  chatbi_ask: { ...RULE_BASE, name: 'chatbi_ask', description: 'ChatBI 提问限流（按用户）', windowMs: 60 * 1000, limit: 10, keyType: 'user', enabled: true, blockedMessage: 'ChatBI 提问过于频繁，请稍后再试', pathPatterns: [] },
  report_chatbi_write: { ...RULE_BASE, name: 'report_chatbi_write', description: 'ChatBI 写操作限流（按用户）', windowMs: 60 * 1000, limit: 30, keyType: 'user', enabled: true, blockedMessage: 'ChatBI 操作过于频繁，请稍后再试', pathPatterns: [] },
  report_fill_write: { ...RULE_BASE, name: 'report_fill_write', description: '报表填报写操作限流（按用户）', windowMs: 60 * 1000, limit: 30, keyType: 'user', enabled: true, blockedMessage: '填报操作过于频繁，请稍后再试', pathPatterns: [] },
  ai_chat_send: { ...RULE_BASE, name: 'ai_chat_send', description: 'AI 对话发送限流（按用户）', windowMs: 60 * 1000, limit: 15, keyType: 'user', enabled: true, blockedMessage: 'AI 对话过于频繁，请稍后再试', pathPatterns: [] },
  ai_share_view: { ...RULE_BASE, name: 'ai_share_view', description: 'AI 对话分享页访问限流（无需登录，防滥用）', windowMs: 60 * 1000, limit: 60, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: [] },
  drive_public_share: { ...RULE_BASE, name: 'drive_public_share', description: '网盘外链公开访问限流（无需登录，防密码爆破 / 防滥用）', windowMs: 60 * 1000, limit: 120, keyType: 'ip', enabled: true, blockedMessage: '访问过于频繁，请稍后再试', pathPatterns: ['/api/drive/public/*'] },
  // 与 shared seed 的 SEED_RATE_LIMIT_RULES 同步：代码默认保证既有环境部署后即生效，DB 行供管理员调参覆盖
  chunk_upload: { ...RULE_BASE, name: 'chunk_upload', description: '分片上传单片接口限流（按用户）：分片不小于 5MB，正常上传远达不到该速率，只拦异常刷片', windowMs: 60 * 1000, limit: 3000, keyType: 'user', enabled: true, blockedMessage: '分片上传过于频繁，请稍后再试', pathPatterns: ['/api/files/upload/chunk', '/api/drive/nodes/upload/chunk', '/api/app-releases/releases/*/artifacts/upload/chunk', '/api/iot/firmwares/upload/chunk'] },
} as const;


export const CODE_RATE_LIMIT_NAMES = [
  'auth', 'captcha', 'sensitive', 'analytics-ingest', 'error-report', 'replay-ingest', 'payment_public_link_pay', 'payment_public_link_session', 'chat_send', 'chatbi_ask', 'report_chatbi_write', 'report_fill_write', 'ai_chat_send', 'ai_share_view'
] as const;
