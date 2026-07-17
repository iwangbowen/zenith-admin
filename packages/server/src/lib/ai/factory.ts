import type { StreamChatConfig, ChatMessage, StreamChunk } from './adapters/openai-compatible';
import { streamChatOpenAICompatible } from './adapters/openai-compatible';

export type { StreamChatConfig, ChatMessage, StreamChunk };

type AiProvider = 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';

const PROVIDER_LABELS: Record<Exclude<AiProvider, 'openai_compatible'>, string> = {
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  baidu: '百度千帆',
};

async function* unsupportedProvider(provider: Exclude<AiProvider, 'openai_compatible'>): AsyncGenerator<StreamChunk> {
  yield {
    type: 'error',
    error: `${PROVIDER_LABELS[provider]} 暂未原生适配，请改用 OpenAI 兼容网关（openai_compatible）接入`,
  };
}

/**
 * 根据 provider 类型返回对应的流式对话 Generator
 * 目前仅原生支持 openai_compatible（覆盖 OpenAI、DeepSeek、Qwen、Kimi、GLM、Ollama 等）；
 * anthropic / gemini / baidu 协议不兼容，直接返回明确错误，待后续按需扩展适配器
 */
export function streamChat(
  provider: AiProvider,
  config: StreamChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  switch (provider) {
    case 'anthropic':
    case 'gemini':
    case 'baidu':
      return unsupportedProvider(provider);
    case 'openai_compatible':
    default:
      return streamChatOpenAICompatible(config, messages, signal);
  }
}
