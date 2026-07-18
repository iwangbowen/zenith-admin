import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../../lib/context';
import { getConfigBoolean } from '../../lib/system-config';
import { getRawDefaultProviderConfig, getRawProviderConfig } from './ai-providers.service';
import { getRawUserAiConfigById } from './user-ai-config.service';
import { buildPreferencePrompt } from './ai-preferences.service';
import { streamChat } from '../../lib/ai/factory';
import { chatOnceOpenAICompatible } from '../../lib/ai/adapters/openai-compatible';
import { getOpenAiToolDefs, executeToolCall } from '../../lib/ai/tools';
import { acquireProviderSlot } from '../../lib/ai/reliability';
import { updateConversationTitle } from './ai-conversations.service';
import logger from '../../lib/logger';
import type { StreamChatConfig, ChatMessage, ChatToolCall, StreamChunk } from '../../lib/ai/factory';
import type { AiProvider, AiModelCapabilities } from '@zenith/shared';

export type { StreamChunk };

type ResolvedStreamConfig = {
  config: StreamChatConfig;
  provider: AiProvider;
  capabilities: AiModelCapabilities | null;
  snapshot: { provider: string; model: string; configId?: number };
  /** 主备切换降级配置 ID */
  fallbackConfigId?: number | null;
  /** 并发流上限 */
  maxConcurrent?: number | null;
};

/** 校验 modelOverride 属于该配置声明的模型集合，返回最终生效模型 */
function applyModelOverride(cfg: { model: string; models?: string[] | null }, modelOverride?: string): string {
  if (!modelOverride || modelOverride === cfg.model) return cfg.model;
  const allowed = cfg.models ?? [];
  if (!allowed.includes(modelOverride)) {
    throw new HTTPException(400, { message: '所选模型不在该服务商配置的模型列表中' });
  }
  return modelOverride;
}

/**
 * 解析当前请求应使用的 AI 配置（未指定时使用系统默认配置）
 */
async function resolveStreamConfig(modelOverride?: string): Promise<ResolvedStreamConfig> {
  // 使用系统默认配置
  const sysCfg = await getRawDefaultProviderConfig();
  if (!sysCfg) throw new HTTPException(503, { message: '系统未配置 AI 服务商，请联系管理员' });
  const model = applyModelOverride(sysCfg, modelOverride);
  return {
    provider: sysCfg.provider,
    capabilities: sysCfg.capabilities ?? null,
    fallbackConfigId: sysCfg.fallbackConfigId,
    maxConcurrent: sysCfg.maxConcurrent,
    config: {
      baseUrl: sysCfg.baseUrl,
      apiKey: sysCfg.apiKey,
      model,
      maxTokens: sysCfg.maxTokens,
      temperature: sysCfg.temperature,
      systemPrompt: sysCfg.systemPrompt,
    },
    snapshot: { provider: sysCfg.provider, model, configId: sysCfg.id },
  };
}

/**
 * 指定 configId 使用系统中的某个 AI 配置
 */
async function resolveStreamConfigById(configId: number, modelOverride?: string): Promise<ResolvedStreamConfig> {
  const sysCfg = await getRawProviderConfig(configId);
  if (!sysCfg.isEnabled) throw new HTTPException(400, { message: '该 AI 配置已禁用，请选择其他模型' });
  const model = applyModelOverride(sysCfg, modelOverride);
  return {
    provider: sysCfg.provider,
    capabilities: sysCfg.capabilities ?? null,
    fallbackConfigId: sysCfg.fallbackConfigId,
    maxConcurrent: sysCfg.maxConcurrent,
    config: {
      baseUrl: sysCfg.baseUrl,
      apiKey: sysCfg.apiKey,
      model,
      maxTokens: sysCfg.maxTokens,
      temperature: sysCfg.temperature,
      systemPrompt: sysCfg.systemPrompt,
    },
    snapshot: { provider: sysCfg.provider, model, configId: sysCfg.id },
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
    capabilities: null,
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

/** 工具调用最多迭代轮数（防死循环） */
const MAX_TOOL_ROUNDS = 5;

export interface StreamAiChatOptions {
  signal?: AbortSignal;
  systemPromptOverride?: string | null;
  /** 多模型配置下选择的具体模型 */
  model?: string;
  /** 是否启用内置工具（还需配置 capabilities.tools 且 provider 为 openai_compatible） */
  enableTools?: boolean;
  /** 温度覆盖（智能体） */
  temperatureOverride?: string | null;
  /** 工具白名单（智能体勾选的工具集；undefined = 全部，[] = 无） */
  toolFilter?: string[] | null;
}

export type StreamAiChatChunk = StreamChunk
  | { type: 'tool_result'; name: string; arguments: string; result: string; durationMs: number }
  | { type: 'failover'; from: string; to: string };

/**
 * 统一聊天流：解析配置 → 注入对话角色 / 个人指令 → 流式生成。
 * 支持 function calling 执行循环（最多 MAX_TOOL_ROUNDS 轮）；
 * 首 token 前失败且配置了降级服务商时自动主备切换（一次）；
 * 服务商配置了并发上限时先获取信号量（超时报错）。
 */
export async function* streamAiChat(
  messages: ChatMessage[],
  configSource?: 'system' | 'user',
  configId?: number,
  options?: StreamAiChatOptions,
): AsyncGenerator<StreamAiChatChunk & { snapshot?: { provider: string; model: string; configId?: number } }> {
  let resolved: ResolvedStreamConfig;
  if (configSource === 'user' && configId) {
    resolved = await resolveStreamConfigForUser(configId);
  } else if (configId) {
    resolved = await resolveStreamConfigById(configId, options?.model);
  } else {
    resolved = await resolveStreamConfig(options?.model);
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    // 对话级提示词模板：覆盖服务商配置中的 systemPrompt
    const override = options?.systemPromptOverride;
    if (typeof override === 'string' && override.trim()) {
      resolved.config.systemPrompt = override;
    }

    if (options?.temperatureOverride?.trim()) {
      resolved.config.temperature = options.temperatureOverride;
    }

    // 个人指令（Custom Instructions）：追加到 system prompt 末尾
    try {
      const user = currentUser();
      const preference = await buildPreferencePrompt(user.userId);
      if (preference) {
        resolved.config.systemPrompt = resolved.config.systemPrompt
          ? `${resolved.config.systemPrompt}\n\n${preference}`
          : preference;
      }
    } catch { /* 无登录上下文（如内部调用）时跳过 */ }

    // function calling：仅 openai_compatible 且配置声明 tools 能力时启用
    const toolsEnabled = options?.enableTools !== false
      && resolved.provider === 'openai_compatible'
      && resolved.capabilities?.tools === true
      && !(options?.toolFilter && options.toolFilter.length === 0);
    if (toolsEnabled) {
      const defs = await getOpenAiToolDefs(options?.toolFilter ?? undefined);
      resolved.config.tools = defs.length > 0 ? defs : undefined;
    } else {
      resolved.config.tools = undefined;
    }

    // 并发信号量（配置了 maxConcurrent 的服务商）
    let release: () => void;
    try {
      release = await acquireProviderSlot(resolved.snapshot.configId, resolved.maxConcurrent);
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : '当前模型并发繁忙' };
      return;
    }

    let contentStarted = false;
    let failoverError: string | null = null;

    try {
      const workingMessages: ChatMessage[] = [...messages];
      let totalTokensInput = 0;
      let totalTokensOutput = 0;
      let isFirst = true;

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        let pendingCalls: ChatToolCall[] | null = null;
        let roundDone = false;

        for await (const chunk of streamChat(resolved.provider, resolved.config, workingMessages, options?.signal)) {
          if (chunk.type === 'tool_calls') {
            contentStarted = true;
            pendingCalls = chunk.calls;
          } else if (chunk.type === 'done') {
            totalTokensInput += chunk.tokensInput;
            totalTokensOutput += chunk.tokensOutput;
            roundDone = true;
            // 还有待执行的工具：先不对外发 done，执行工具后续跑
            if (!pendingCalls) {
              yield { type: 'done', tokensInput: totalTokensInput, tokensOutput: totalTokensOutput, snapshot: resolved.snapshot };
              return;
            }
          } else if (chunk.type === 'error') {
            // 首 token 前失败且有降级配置：触发主备切换重试
            if (!contentStarted && attempt === 0 && resolved.fallbackConfigId) {
              failoverError = chunk.error;
              break;
            }
            yield chunk;
            return;
          } else if (chunk.type === 'delta' || chunk.type === 'reasoning') {
            contentStarted = true;
            if (chunk.type === 'delta' && isFirst) {
              isFirst = false;
              yield { ...chunk, snapshot: resolved.snapshot };
            } else {
              yield chunk;
            }
          } else {
            yield chunk;
          }
        }

        if (failoverError) break;

        if (!pendingCalls || pendingCalls.length === 0) {
          // 流异常结束（无 done 无工具）：直接返回
          if (!roundDone) return;
          yield { type: 'done', tokensInput: totalTokensInput, tokensOutput: totalTokensOutput, snapshot: resolved.snapshot };
          return;
        }

        if (round === MAX_TOOL_ROUNDS) {
          yield { type: 'error', error: '工具调用轮数超出上限，请简化问题后重试' };
          return;
        }

        // 执行工具并把过程结果推送给前端
        workingMessages.push({ role: 'assistant', content: '', tool_calls: pendingCalls });
        for (const call of pendingCalls) {
          const toolStart = Date.now();
          const result = await executeToolCall(call);
          yield { type: 'tool_result', name: call.function.name, arguments: call.function.arguments, result, durationMs: Date.now() - toolStart };
          workingMessages.push({ role: 'tool', content: result, tool_call_id: call.id });
        }
      }
    } finally {
      release();
    }

    // 主备切换：解析降级配置并重试一轮
    if (failoverError && resolved.fallbackConfigId) {
      const from = `${resolved.snapshot.provider}/${resolved.snapshot.model}`;
      let fallback: ResolvedStreamConfig;
      try {
        fallback = await resolveStreamConfigById(resolved.fallbackConfigId);
      } catch {
        yield { type: 'error', error: failoverError };
        return;
      }
      // 防链式降级：降级配置自身的 fallback 不再生效
      fallback.fallbackConfigId = null;
      logger.warn(`[ai-chat] provider failover: ${from} -> ${fallback.snapshot.provider}/${fallback.snapshot.model} (${failoverError})`);
      yield { type: 'failover', from, to: `${fallback.snapshot.provider}/${fallback.snapshot.model}` };
      resolved = fallback;
      continue;
    }
    return;
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
