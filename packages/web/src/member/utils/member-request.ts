import { MEMBER_TOKEN_KEY, MEMBER_REFRESH_TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';
import { HttpClient, type HttpRequestOptions } from '@/utils/http-client';

/**
 * 会员前台专用 HTTP 客户端（与后台 admin request 完全隔离）。
 * - 携带独立的会员 token（MEMBER_TOKEN_KEY）
 * - 401 自动走 /api/member/auth/refresh 刷新，失败跳转会员登录页
 * - HashRouter 入口：登录页为 /member.html#/login
 *
 * 通用逻辑见 @/utils/http-client.ts。
 */

export type MemberRequestOptions = HttpRequestOptions;

function memberLoginUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || '';
  return `${base}/member.html#/login`;
}

export const memberRequest = new HttpClient({
  baseUrl: config.apiBaseUrl,
  tokenKey: MEMBER_TOKEN_KEY,
  refreshTokenKey: MEMBER_REFRESH_TOKEN_KEY,
  refreshPath: '/api/member/auth/refresh',
  loginUrl: memberLoginUrl,
});
