import type { OAuthProviderType } from '@zenith/shared';

export interface OAuthUserInfo {
  openId: string;
  unionId?: string;
  nickname: string;
  avatar?: string;
  email?: string;
}

export interface OAuthTokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  agentId?: string | null;
  corpId?: string | null;
  callbackBaseUrl: string;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  agentId?: string | null;
  corpId?: string | null;
  callbackBaseUrl: string;
}

export interface OAuthProvider {
  readonly provider: OAuthProviderType;
  getAuthUrl(state: string): string;
  getToken(code: string): Promise<OAuthTokenResult>;
  getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo>;
}
