import { httpGet } from '../http-client';
import { WechatApiError } from './access-token';

const OAUTH_API_BASE = 'https://api.weixin.qq.com';

export type OAuthScope = 'snsapi_base' | 'snsapi_userinfo';

/** 构建网页授权跳转链接（用户在微信内打开后授权，微信回跳 redirectUri?code=&state=） */
export function buildWebAuthorizeUrl(appId: string, redirectUri: string, scope: OAuthScope, state: string): string {
  const params = new URLSearchParams({
    appid: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state: state || '',
  });
  return `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`;
}

interface OAuthTokenResponse {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  openid?: string;
  scope?: string;
  unionid?: string;
}

/** 用 code 换取网页授权 access_token + openid（绑定开放平台时含 unionid） */
export async function exchangeWebAuthCode(
  appId: string,
  appSecret: string,
  code: string,
): Promise<{ accessToken: string; openid: string; scope: string; unionid: string | null }> {
  const url = `${OAUTH_API_BASE}/sns/oauth2/access_token?appid=${encodeURIComponent(appId)}`
    + `&secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const resp = await httpGet(url, { timeout: 10_000, httpLog: { level: 'off' } });
  const data = await resp.json<OAuthTokenResponse>();
  if (data.errcode && data.errcode !== 0) throw new WechatApiError(data.errcode, data.errmsg ?? '换取网页授权失败');
  if (!data.access_token || !data.openid) throw new WechatApiError(-1, '换取网页授权失败：缺少 access_token/openid');
  return { accessToken: data.access_token, openid: data.openid, scope: data.scope ?? '', unionid: data.unionid ?? null };
}

export interface WebAuthUserInfo {
  openid: string;
  nickname?: string;
  sex?: number;
  province?: string;
  city?: string;
  country?: string;
  headimgurl?: string;
  unionid?: string;
}

/** 拉取网页授权用户信息（scope=snsapi_userinfo 时可用） */
export async function getWebAuthUserInfo(accessToken: string, openid: string): Promise<WebAuthUserInfo> {
  const url = `${OAUTH_API_BASE}/sns/userinfo?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openid)}&lang=zh_CN`;
  const resp = await httpGet(url, { timeout: 10_000, httpLog: { level: 'off' } });
  const data = await resp.json<WebAuthUserInfo & { errcode?: number; errmsg?: string }>();
  if (data.errcode && data.errcode !== 0) throw new WechatApiError(data.errcode, data.errmsg ?? '获取网页授权用户信息失败');
  return data;
}
