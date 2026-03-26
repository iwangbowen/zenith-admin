import { config } from '../../config';
import type { OAuthProvider, OAuthTokenResult, OAuthUserInfo } from './types';

const OLD_API = 'https://oapi.dingtalk.com';
const NEW_API = 'https://api.dingtalk.com';

export class DingTalkProvider implements OAuthProvider {
  readonly provider = 'dingtalk' as const;

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: config.oauth.dingtalk.clientId,
      redirect_uri: `${config.oauth.callbackBaseUrl}/oauth/callback/dingtalk`,
      response_type: 'code',
      scope: 'openid',
      prompt: 'consent',
      state,
    });
    return `${NEW_API}/v1.0/contact/users/me?${params}`;
    // 实际授权页面
    // return `https://login.dingtalk.com/oauth2/auth?${params}`;
  }

  async getToken(code: string): Promise<OAuthTokenResult> {
    const resp = await fetch(`${NEW_API}/v1.0/oauth2/userAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: config.oauth.dingtalk.clientId,
        clientSecret: config.oauth.dingtalk.clientSecret,
        code,
        grantType: 'authorization_code',
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (!data.accessToken) throw new Error(`DingTalk OAuth error: ${JSON.stringify(data)}`);
    return {
      accessToken: data.accessToken as string,
      refreshToken: data.refreshToken as string | undefined,
      expiresIn: data.expireIn as number | undefined,
    };
  }

  async getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo> {
    const resp = await fetch(`${NEW_API}/v1.0/contact/users/me`, {
      headers: { 'x-acs-dingtalk-access-token': token.accessToken },
    });
    const data = await resp.json() as Record<string, unknown>;
    return {
      openId: data.openId as string,
      unionId: data.unionId as string | undefined,
      nickname: (data.nick as string) || '',
      avatar: data.avatarUrl as string | undefined,
      email: data.email as string | undefined,
    };
  }
}
