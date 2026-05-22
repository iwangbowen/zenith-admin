import { httpGet, HttpClientError } from '../http-client';
import type { OAuthProvider, OAuthProviderConfig, OAuthTokenResult, OAuthUserInfo } from './types';

export class WeChatWorkProvider implements OAuthProvider {
  readonly provider = 'wechat_work' as const;
  constructor(private readonly cfg: OAuthProviderConfig) {}

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      appid: this.cfg.corpId || '',
      agentid: this.cfg.agentId || '',
      redirect_uri: `${this.cfg.callbackBaseUrl}/oauth/callback/wechat_work`,
      response_type: 'code',
      scope: 'snsapi_privateinfo',
      state,
    });
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params}#wechat_redirect`;
  }

  async getToken(code: string): Promise<OAuthTokenResult> {
    const params = new URLSearchParams({
      corpid: this.cfg.corpId || '',
      corpsecret: this.cfg.clientSecret,
    });
    const resp = await httpGet(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${params}`);
    if (!resp.ok) throw new HttpClientError('WeChatWork token request failed', { status: resp.status, url: resp.url });
    const data = await resp.json<Record<string, unknown>>();
    if (data.errcode) throw new Error(`WeChatWork token error: ${data.errmsg}`);
    // 将 code 暂存在 refreshToken 中，供 getUserInfo 使用
    return { accessToken: data.access_token as string, refreshToken: code, expiresIn: data.expires_in as number };
  }

  async getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo> {
    const code = token.refreshToken || '';
    const params = new URLSearchParams({
      access_token: token.accessToken,
      code,
    });
    const resp = await httpGet(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?${params}`);
    if (!resp.ok) throw new HttpClientError('WeChatWork userinfo request failed', { status: resp.status, url: resp.url });
    const data = await resp.json<Record<string, unknown>>();
    if (data.errcode) throw new Error(`WeChatWork userinfo error: ${data.errmsg}`);

    const userId = (data.userid || data.UserId) as string;
    const detailParams = new URLSearchParams({ access_token: token.accessToken, userid: userId });
    const detailResp = await httpGet(`https://qyapi.weixin.qq.com/cgi-bin/user/get?${detailParams}`);
    if (!detailResp.ok) throw new HttpClientError('WeChatWork user/get request failed', { status: detailResp.status, url: detailResp.url });
    const detail = await detailResp.json<Record<string, unknown>>();

    return {
      openId: userId,
      nickname: (detail.name as string) || userId,
      avatar: detail.avatar as string | undefined,
      email: detail.email as string | undefined,
    };
  }
}
