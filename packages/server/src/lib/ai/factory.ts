import type { StreamChatConfig, ChatMessage, ChatMessagePart, ChatToolCall, StreamChunk } from './adapters/openai-compatible';
import { streamChatOpenAICompatible } from './adapters/openai-compatible';
import { streamChatAnthropic } from './adapters/anthropic';
import { streamChatGemini } from './adapters/gemini';

export type { StreamChatConfig, ChatMessage, ChatMessagePart, ChatToolCall, StreamChunk };

type AiProvider = 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';

async function* unsupportedProvider(label: string): AsyncGenerator<StreamChunk> {
  yield {
    type: 'error',
    error: `${label} 暂未原生适配，请改用 OpenAI 兼容网关（openai_compatible）接入`,
  };
}

/**
 * 根据 provider 类型返回对应的流式对话 Generator：
 * - openai_compatible：/chat/completions（OpenAI、DeepSeek、Qwen、Kimi、GLM、Ollama 等），支持 tools / vision / reasoning
 * - anthropic：/v1/messages（x-api-key），支持 vision / thinking
 * - gemini：models/{model}:streamGenerateContent?alt=sse，支持 vision
 * - baidu：千帆原生协议未适配（其 OpenAI 兼容端点请用 openai_compatible 接入）
 */
export function streamChat(
  provider: AiProvider,
  config: StreamChatConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  switch (provider) {
    case 'anthropic':
      return streamChatAnthropic(config, messages, signal);
    case 'gemini':
      return streamChatGemini(config, messages, signal);
    case 'baidu':
      return unsupportedProvider('百度千帆');
    case 'openai_compatible':
    default:
      return streamChatOpenAICompatible(config, messages, signal);
  }
}