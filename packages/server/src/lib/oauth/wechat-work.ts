import { config } from '../../config';
import type { OAuthProvider, OAuthTokenResult, OAuthUserInfo } from './types';

export class WeChatWorkProvider implements OAuthProvider {
  readonly provider = 'wechat_work' as const;

  getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      appid: config.oauth.wechatWork.corpId,
      agentid: config.oauth.wechatWork.agentId,
      redirect_uri: `${config.oauth.callbackBaseUrl}/oauth/callback/wechat_work`,
      response_type: 'code',
      scope: 'snsapi_privateinfo',
      state,
    });
    return `https://open.weixin.qq.com/connect/oauth2/authorize?${params}#wechat_redirect`;
  }

  async getToken(code: string): Promise<OAuthTokenResult> {
    const params = new URLSearchParams({
      corpid: config.oauth.wechatWork.corpId,
      corpsecret: config.oauth.wechatWork.secret,
    });
    const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${params}`);
    const data = await resp.json() as Record<string, unknown>;
    if (data.errcode) throw new Error(`WeChatWork token error: ${data.errmsg}`);
    return { accessToken: data.access_token as string, expiresIn: data.expires_in as number };
  }

  async getUserInfo(token: OAuthTokenResult): Promise<OAuthUserInfo> {
    // WeChatWork needs a second call with the code to get userId, but in the flow
    // we store the code in OAuthTokenResult.accessToken temporarily,
    // then resolve user info here. This is adapted for the two-step flow.
    // In practice, the callback route will pass `code` through token.refreshToken.
    const code = token.refreshToken || '';
    const params = new URLSearchParams({
      access_token: token.accessToken,
      code,
    });
    const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?${params}`);
    const data = await resp.json() as Record<string, unknown>;
    if (data.errcode) throw new Error(`WeChatWork userinfo error: ${data.errmsg}`);

    const userId = (data.userid || data.UserId) as string;
    // get detailed user info
    const detailParams = new URLSearchParams({ access_token: token.accessToken, userid: userId });
    const detailResp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/get?${detailParams}`);
    const detail = await detailResp.json() as Record<string, unknown>;

    return {
      openId: userId,
      nickname: (detail.name as string) || userId,
      avatar: detail.avatar as string | undefined,
      email: detail.email as string | undefined,
    };
  }
}
