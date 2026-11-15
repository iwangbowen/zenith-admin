/** Method + complete route patterns, never broad URL-prefix exemptions. */
export const MAINTENANCE_EXCEPTIONS = [
  ...['/api/health', '/api/health/livez', '/api/health/readyz', '/api/health/startupz', '/api/maintenance/status', '/api/settings/public'].map((path) => ({ method: 'GET', path, reason: '状态探测或认证所需公开配置' })),
  ...['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/mfa/verify', '/api/auth/session-conflict/resolve', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/enterprise/ldap/login', '/api/auth/enterprise/callback', '/api/auth/enterprise/saml/acs'].map((path) => ({ method: 'POST', path, reason: '认证或账号恢复，仍执行原有验证' })),
  ...['/api/auth/me', '/api/auth/captcha', '/api/auth/oauth/providers', '/api/auth/oauth/{provider}', '/api/auth/enterprise/providers', '/api/auth/enterprise/{id}'].map((path) => ({ method: 'GET', path, reason: '认证与当前身份' })),
  { method: 'POST', path: '/api/auth/oauth/{provider}/callback', reason: '第三方登录，仍校验 OAuth 状态与凭证' },
  { method: 'GET', path: '/api/maintenance/access', reason: '当前主体维护能力，仍执行认证' },
  { method: 'POST', path: '/api/public/payment/notify/{channel}/{callbackToken}', reason: '支付结果接收，仍执行验签与幂等' },
] as const;
export function maintenancePathMatches(pattern: string, path: string) {
  const a = pattern.split('/'); const b = path.split('/');
  return a.length === b.length && a.every((part, index) => /^\{\w+\}$/.test(part) ? b[index].length > 0 : part === b[index]);
}
export function maintenanceException(method: string, path: string) {
  return MAINTENANCE_EXCEPTIONS.find((entry) => entry.method === method && maintenancePathMatches(entry.path, path));
}
export const MAINTENANCE_BOUNDARIES = ['仅控制 API 与实时业务入口，不是数据库只读锁', '已有 HTTP 请求、后台任务和关键回调可能继续写入', '非 API 的 CMS、短链和静态资源由部署层控制'];
