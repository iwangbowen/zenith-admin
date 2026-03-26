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
    const resp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code,
      }),
    });
    const data = await resp.json() as Record<string, unknown>;
    if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    return { accessToken: data.access_token as string };
  }

  async getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo> {
    const resp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: 'application/json' },
    });
    const user = await resp.json() as Record<string, unknown>;
    return {
      openId: String(user.id),
      nickname: (user.login as string) || (user.name as string) || '',
      avatar: user.avatar_url as string | undefined,
      email: user.email as string | undefined,
    };
  }
}
