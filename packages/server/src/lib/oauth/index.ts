import { eq } from 'drizzle-orm';
import type { OAuthProviderType } from '@zenith/shared';
import type { OAuthProvider, OAuthProviderConfig } from './types';
import { GitHubProvider } from './github';
import { DingTalkProvider } from './dingtalk';
import { WeChatWorkProvider } from './wechat-work';
import { db } from '../../db';
import { oauthConfigs } from '../../db/schema';
import { config } from '../../config';

export type { OAuthProvider, OAuthProviderConfig, OAuthUserInfo, OAuthTokenResult } from './types';

/** 从数据库加载 OAuth 配置，构建 Provider 实例 */
async function loadProviderConfig(type: OAuthProviderType): Promise<OAuthProviderConfig | null> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, type)).limit(1);
  if (!row?.clientId || !row.clientSecret) return null;
  return {
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    agentId: row.agentId,
    corpId: row.corpId,
    callbackBaseUrl: config.oauth.callbackBaseUrl,
  };
}

function createProvider(type: OAuthProviderType, cfg: OAuthProviderConfig): OAuthProvider {
  switch (type) {
    case 'github': return new GitHubProvider(cfg);
    case 'dingtalk': return new DingTalkProvider(cfg);
    case 'wechat_work': return new WeChatWorkProvider(cfg);
    default: throw new Error(`Unsupported OAuth provider: ${type}`);
  }
}

/** 获取 OAuth provider（从 DB 读取配置） */
export async function getOAuthProvider(type: OAuthProviderType): Promise<OAuthProvider> {
  const cfg = await loadProviderConfig(type);
  if (!cfg) throw new Error(`OAuth provider "${type}" 尚未配置或配置不完整`);
  return createProvider(type, cfg);
}

/** 检查 OAuth 提供方是否已在 DB 中配置好必要的凭据且已启用 */
export async function isProviderConfigured(type: OAuthProviderType): Promise<boolean> {
  const [row] = await db.select().from(oauthConfigs).where(eq(oauthConfigs.provider, type)).limit(1);
  if (!row || !row.enabled || !row.clientId || !row.clientSecret) return false;
  if (type === 'wechat_work' && !row.corpId) return false;
  return true;
}
