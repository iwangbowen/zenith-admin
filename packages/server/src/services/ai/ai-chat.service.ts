import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getConfigBoolean } from '../../lib/system-config';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import { getRawUserAiConfigById } from './user-ai-config.service';
import { streamChat } from '../../lib/ai/factory';
import type { StreamChatConfig, ChatMessage, StreamChunk } from '../../lib/ai/factory';
import type { AiProvider } from '@zenith/shared';

export type { StreamChunk };

type ResolvedStreamConfig = {
  config: StreamChatConfig;
  provider: AiProvider;
  snapshot: { provider: string; model: string; configId?: number };
};

/**
 * 解析当前请求应使用的 AI 配置（未指定时使用系统默认配置）
 */
async function resolveStreamConfig(): Promise<ResolvedStreamConfig> {
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
async function resolveStreamConfigById(configId: number): Promise<ResolvedStreamConfig> {
  const sysCfg = await getRawProviderConfig(configId);
  if (!sysCfg.isEnabled) throw new HTTPException(400, { message: '该 AI 配置已禁用，请选择其他模型' });
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

async function resolveStreamConfigForUser(userConfigId: number): Promise<ResolvedStreamConfig> {
  const allowed = await getConfigBoolean('ai_allow_user_custom_key', false);
  if (!allowed) throw new HTTPException(403, { message: '管理员未开放自定义 AI 配置' });
  const user = currentUser();
  const userCfg = await getRawUserAiConfigById(userConfigId, user.userId);
  if (!userCfg?.isEnabled || !userCfg.apiKey || !userCfg.baseUrl || !userCfg.model) {
    throw new HTTPException(400, { message: '用户 AI 配置不完整，请先在设置中填写 API 地址、API Key 和模型名称' });
  }
  return {
    provider: userCfg.provider,
    config: {
      baseUrl: userCfg.baseUrl,
      apiKey: userCfg.apiKey,
      model: userCfg.model,
      maxTokens: userCfg.maxTokens ?? 4096,
      temperature: userCfg.temperature ?? '0.7',
      systemPrompt: userCfg.systemPrompt ?? null,
    },
    snapshot: { provider: userCfg.provider, model: userCfg.model },
  };
}

export async function* streamAiChat(
  messages: ChatMessage[],
  configSource?: 'system' | 'user',
  configId?: number,
  options?: { signal?: AbortSignal; systemPromptOverride?: string | null },
): AsyncGenerator<StreamChunk & { snapshot?: { provider: string; model: string; configId?: number } }> {
  let resolved: ResolvedStreamConfig;
  if (configSource === 'user' && configId) {
    resolved = await resolveStreamConfigForUser(configId);
  } else if (configSource === 'system' && configId) {
    resolved = await resolveStreamConfigById(configId);
  } else if (configId) {
    resolved = await resolveStreamConfigById(configId);
  } else {
    resolved = await resolveStreamConfig();
  }

  // 对话级提示词模板：覆盖服务商配置中的 systemPrompt
  const override = options?.systemPromptOverride;
  if (typeof override === 'string' && override.trim()) {
    resolved.config.systemPrompt = override;
  }

  let isFirst = true;
  for await (const chunk of streamChat(resolved.provider, resolved.config, messages, options?.signal)) {
    if (isFirst && chunk.type === 'delta') {
      yield { ...chunk, snapshot: resolved.snapshot };
      isFirst = false;
    } else if (chunk.type === 'done') {
      yield { ...chunk, snapshot: resolved.snapshot };
    } else {
      yield chunk;
    }
  }
}
