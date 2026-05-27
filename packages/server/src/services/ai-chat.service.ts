import { HTTPException } from 'hono/http-exception';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { systemConfigs } from '../db/schema';
import { currentUser } from '../lib/context';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import { getRawUserAiConfig } from './user-ai-config.service';
import { streamChat } from '../lib/ai/factory';
import type { StreamChatConfig, ChatMessage, StreamChunk } from '../lib/ai/factory';

export type { StreamChunk };

/**
 * 解析当前请求应使用的 AI 配置
 * 优先级：用户自定义 Key（若系统允许 && 用户已启用 && 有效） > 系统默认配置
 */
async function resolveStreamConfig(): Promise<{
  config: StreamChatConfig;
  provider: 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';
  snapshot: { provider: string; model: string; configId?: number };
}> {
  const user = currentUser();

  // 检查系统是否允许用户自定义 Key
  const [cfgRow] = await db.select().from(systemConfigs).where(eq(systemConfigs.configKey, 'ai_allow_user_custom_key')).limit(1);
  const allowUserKey = cfgRow?.configValue === 'true';

  if (allowUserKey) {
    const userCfg = await getRawUserAiConfig(user.userId);
    if (userCfg && userCfg.isEnabled && userCfg.apiKey && userCfg.baseUrl && userCfg.model) {
      return {
        provider: userCfg.provider,
        config: {
          baseUrl: userCfg.baseUrl,
          apiKey: userCfg.apiKey,
          model: userCfg.model,
          maxTokens: 4096,
          temperature: '0.7',
          systemPrompt: null,
        },
        snapshot: { provider: userCfg.provider, model: userCfg.model },
      };
    }
  }

  // 使用系统默认配置
  const sysCfg = await getRawDefaultProviderConfig();
  if (!sysCfg) throw new HTTPException(503, { message: '系统未配置 AI 服务商，请联系管理员' });

  return {
    provider: sysCfg.provider,
    config: {
      baseUrl: sysCfg.baseUrl,
      apiKey: sysCfg.apiKey,
      model: sysCfg.model,
      maxTokens: sysCfg.maxTokens,
      temperature: sysCfg.temperature,
      systemPrompt: sysCfg.systemPrompt,
    },
    snapshot: { provider: sysCfg.provider, model: sysCfg.model, configId: sysCfg.id },
  };
}

/**
 * 指定 configId 使用系统中的某个 AI 配置（管理员用）
 */
async function resolveStreamConfigById(configId: number): Promise<{
  config: StreamChatConfig;
  provider: 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';
  snapshot: { provider: string; model: string; configId?: number };
}> {
  const sysCfg = await getRawProviderConfig(configId);
  return {
    provider: sysCfg.provider,
    config: {
      baseUrl: sysCfg.baseUrl,
      apiKey: sysCfg.apiKey,
      model: sysCfg.model,
      maxTokens: sysCfg.maxTokens,
      temperature: sysCfg.temperature,
      systemPrompt: sysCfg.systemPrompt,
    },
    snapshot: { provider: sysCfg.provider, model: sysCfg.model, configId: sysCfg.id },
  };
}

export async function* streamAiChat(
  messages: ChatMessage[],
  configId?: number,
): AsyncGenerator<StreamChunk & { snapshot?: { provider: string; model: string; configId?: number } }> {
  const resolved = configId
    ? await resolveStreamConfigById(configId)
    : await resolveStreamConfig();

  let isFirst = true;
  for await (const chunk of streamChat(resolved.provider, resolved.config, messages)) {
    if (isFirst && chunk.type === 'delta') {
      yield { ...chunk, snapshot: resolved.snapshot };
      isFirst = false;
    } else if (chunk.type === 'done') {
      yield { ...chunk, snapshot: resolved.snapshot };
    } else {
      yield chunk;
    }
    isFirst = false;
  }
}
