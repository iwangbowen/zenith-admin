import { httpGet, httpPost, HttpClientError } from '../http-client';
import type { OAuthProvider, OAuthProviderConfig, OAuthTokenResult, OAuthUserInfo } from './types';

export class GitHubProvider implements OAuthProvider {
  readonly provider = 'github' as const;
  constructor(private readonly cfg: OAuthProviderConfig) {}

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: `${this.cfg.callbackBaseUrl}/oauth/callback/github`,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async getToken(code: string): Promise<OAuthTokenResult> {
    const resp = await httpPost('https://github.com/login/oauth/access_token', {
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
    }, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) throw new HttpClientError('GitHub token request failed', { status: resp.status, url: resp.url });
    const data = await resp.json<Record<string, unknown>>();
    if (data.error) throw new Error(`GitHub OAuth error: ${(data.error_description || data.error) as string}`);
    return { accessToken: data.access_token as string };
  }

  async getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo> {
    const resp = await httpGet('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new HttpClientError('GitHub userinfo request failed', { status: resp.status, url: resp.url });
    const user = await resp.json<Record<string, unknown>>();
    return {
      openId: String(user.id),
      nickname: (user.login as string) || (user.name as string) || '',
      avatar: user.avatar_url as string | undefined,
      email: user.email as string | undefined,
    };
  }
}
