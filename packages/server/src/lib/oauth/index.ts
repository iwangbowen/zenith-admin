import type { OAuthProviderType } from '@zenith/shared';
import type { OAuthProvider } from './types';
import { GitHubProvider } from './github';
import { DingTalkProvider } from './dingtalk';
import { WeChatWorkProvider } from './wechat-work';

export type { OAuthProvider, OAuthUserInfo, OAuthTokenResult } from './types';

const providers = new Map<OAuthProviderType, OAuthProvider>([
  ['github', new GitHubProvider()],
  ['dingtalk', new DingTalkProvider()],
  ['wechat_work', new WeChatWorkProvider()],
]);

export function getOAuthProvider(type: OAuthProviderType): OAuthProvider {
  const provider = providers.get(type);
  if (!provider) throw new Error(`Unsupported OAuth provider: ${type}`);
  return provider;
}
