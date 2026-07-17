import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getConfigBoolean } from '../../lib/system-config';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import { getRawUserAiConfigById } from './user-ai-config.service';
import { streamChat } from '../../lib/ai/factory';
import { chatOnceOpenAICompatible } from '../../lib/ai/adapters/openai-compatible';
import { updateConversationTitle } from './ai-conversations.service';
import logger from '../../lib/logger';
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

const TITLE_MAX_LEN = 30;

/** 去掉 LLM 生成标题中的引号 / 句号 / 思维链残留，并截断长度 */
function sanitizeTitle(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replaceAll('\n', ' ')
    .replaceAll(/["'“”‘’《》<>#*`]/g, '')
    .replace(/[。.．\s]+$/, '')
    .trim()
    .slice(0, TITLE_MAX_LEN);
}

/**
 * 首轮对话后用 LLM 生成对话标题（使用系统默认配置的非流式调用）。
 * 任一环节失败回退为用户消息前 30 字。返回最终生效的标题。
 */
export async function generateConversationTitle(
  conversationId: number,
  userMessage: string,
  assistantReply: string,
): Promise<string> {
  const fallback = userMessage.slice(0, TITLE_MAX_LEN);
  let title = fallback;
  try {
    const sysCfg = await getRawDefaultProviderConfig();
    if (sysCfg && sysCfg.provider === 'openai_compatible') {
      const raw = await chatOnceOpenAICompatible(
        {
          baseUrl: sysCfg.baseUrl,
          apiKey: sysCfg.apiKey,
          model: sysCfg.model,
          maxTokens: 60,
          temperature: '0.3',
          systemPrompt: null,
        },
        [
          {
            role: 'user',
            content: `请用不超过 15 个字概括下面这段对话的主题，直接输出标题本身，不要引号、句号或任何解释。\n\n用户：${userMessage.slice(0, 500)}\n助手：${assistantReply.slice(0, 500)}`,
          },
        ],
        { timeoutMs: 8000 },
      );
      const sanitized = sanitizeTitle(raw);
      if (sanitized) title = sanitized;
    }
  } catch (err) {
    logger.warn('[ai-chat] auto title generation failed, fallback to prefix', err);
  }
  await updateConversationTitle(conversationId, title);
  return title;
}
