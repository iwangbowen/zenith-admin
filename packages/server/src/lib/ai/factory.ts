import type { StreamChatConfig, ChatMessage, StreamChunk } from './adapters/openai-compatible';
import { streamChatOpenAICompatible } from './adapters/openai-compatible';

export type { StreamChatConfig, ChatMessage, StreamChunk };

type AiProvider = 'openai_compatible' | 'anthropic' | 'gemini' | 'baidu';

/**
 * 根据 provider 类型返回对应的流式对话 Generator
 * 目前 openai_compatible 覆盖主流供应商，其他占位待扩展
 */
export function streamChat(
  provider: AiProvider,
  config: StreamChatConfig,
  messages: ChatMessage[],
): AsyncGenerator<StreamChunk> {
  switch (provider) {
    case 'openai_compatible':
    // anthropic / gemini / baidu 暂时均走 openai_compatible 格式，后续按需扩展
    /* falls through */
    case 'anthropic':
    /* falls through */
    case 'gemini':
    /* falls through */
    case 'baidu':
    /* falls through */
    default:
      return streamChatOpenAICompatible(config, messages);
  }
}
