import type { OAuthProviderType } from './constants';

// ─── JWT Payload ──────────────────────────────────────────────────────────────
export interface JwtPayload {
  userId: number;
  username: string;
  roles: string[];
  tenantId: number | null;
  /** 超管切换租户视角时，存放目标租户 ID */
  viewingTenantId?: number | null;
  jti?: string;
}

// ─── OAuth 第三方登录（UI 视图模型）──────────────────────────────────────────
export interface OAuthProviderInfo {
  key: OAuthProviderType;
  label: string;
  icon: string;
}

/** 前端在跳转到提供方之前暂存于 sessionStorage 的 OAuth 往返上下文 */
export interface OAuthPendingState {
  state: string;
  provider: OAuthProviderType;
  intent: 'login' | 'bind';
  redirectTo?: string | null;
}

export type { UserAiConfig } from '../ai/contracts';
