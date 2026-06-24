import { HTTPException } from 'hono/http-exception';
import { ensureMpAccountExists, getMpAccountAuthCredential } from './mp-account.service';
import { buildWebAuthorizeUrl, exchangeWebAuthCode, getWebAuthUserInfo } from '../lib/wechat';
import type { OAuthScope } from '../lib/wechat';
import { mapWechatError } from '../lib/wechat-error';
import type { BuildMpOAuthUrlInput } from '@zenith/shared';

/** 构建网页授权跳转链接（管理端工具，便于集成/测试 H5 授权）。 */
export async function buildMpOAuthUrl(input: BuildMpOAuthUrlInput) {
  const account = await ensureMpAccountExists(input.accountId);
  const url = buildWebAuthorizeUrl(account.appId, input.redirectUri, input.scope as OAuthScope, input.state ?? '');
  return { url };
}

export interface MpOAuthResult {
  openid: string;
  unionid: string | null;
  scope: string;
  userInfo: { nickname?: string; sex?: number; province?: string; city?: string; country?: string; headimgurl?: string } | null;
}

/** 公开回调：用 code 换取 openid/unionid，snsapi_userinfo 时附带用户信息。 */
export async function handleMpOAuthCallback(accountId: number, code: string): Promise<MpOAuthResult> {
  const account = await getMpAccountAuthCredential(accountId);
  if (!account) throw new HTTPException(404, { message: '公众号不存在' });
  if (!account.appSecret) throw new HTTPException(400, { message: '公众号未配置 AppSecret' });
  try {
    const token = await exchangeWebAuthCode(account.appId, account.appSecret, code);
    let userInfo: MpOAuthResult['userInfo'] = null;
    if (token.scope.includes('snsapi_userinfo')) {
      const info = await getWebAuthUserInfo(token.accessToken, token.openid);
      userInfo = { nickname: info.nickname, sex: info.sex, province: info.province, city: info.city, country: info.country, headimgurl: info.headimgurl };
    }
    return { openid: token.openid, unionid: token.unionid, scope: token.scope, userInfo };
  } catch (err) {
    return mapWechatError(err);
  }
}
